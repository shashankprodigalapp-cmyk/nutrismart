/**
 * netlify/functions/get-admin-analytics.ts — Admin Analytics Endpoint
 * Module 8, Step 8.1
 *
 * Returns aggregated usage and subscription health metrics for the admin dashboard.
 * Access is gated on admin_users table membership — non-admins receive 403.
 *
 * All queries use the Supabase service role key to bypass RLS and access
 * aggregated data across all users.
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import { supabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from './_shared/auth';

// ── TYPES ─────────────────────────────────────────────────────────────────────

type TimeFrame = '24h' | '7d' | '30d' | 'ytd';

interface AnalyticsReport {
  generated_at:    string;
  time_frame:      TimeFrame;
  dau_mau:         DAUMAUReport;
  onboarding_funnel: FunnelReport;
  subscriptions:   SubscriptionReport;
  ai_usage:        AIUsageReport;
}

interface DAUMAUReport {
  dau:       number;
  mau:       number;
  ratio:     number;
  dau_trend: Array<{ date: string; count: number }>;  // last 30 days
}

interface FunnelReport {
  splash_views:   number;
  auth_attempts:  number;
  tnc_accepts:    number;
  profiling_done: number;
  first_log:      number;
  conversion_rates: {
    splash_to_auth:     number;
    auth_to_tnc:        number;
    tnc_to_profile:     number;
    profile_to_first_log: number;
    overall:            number;
  };
}

interface SubscriptionReport {
  total_active:   number;
  total_free:     number;
  total_grace:    number;
  total_churned:  number;
  mrr:            number;  // monthly recurring revenue in INR
  payment_failure_rate: number;
  grace_recovery_rate:  number;
  plan_breakdown: { plan: string; count: number }[];
}

interface AIUsageReport {
  total_searches:     number;
  name_searches:      number;
  description_searches: number;
  photo_searches:     number;
  ai_search_rate:     number;  // % of DAU using AI search
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getWindowStart(frame: TimeFrame): string {
  const now = new Date();
  switch (frame) {
    case '24h': return new Date(now.getTime() - 86_400_000).toISOString();
    case '7d':  return new Date(now.getTime() - 7 * 86_400_000).toISOString();
    case '30d': return new Date(now.getTime() - 30 * 86_400_000).toISOString();
    case 'ytd': return new Date(now.getFullYear(), 0, 1).toISOString();
  }
}

// ── DAU / MAU ─────────────────────────────────────────────────────────────────

async function getDAUMAU(windowStart: string): Promise<DAUMAUReport> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // DAU: unique users with events today
  const { data: dauData } = await supabaseAdmin.rpc('count_distinct_users_since', {
    p_since: new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
  }).catch(() => ({ data: null }));

  // MAU: unique users with events in last 30 days
  const { data: mauData } = await supabaseAdmin.rpc('count_distinct_users_since', {
    p_since: thirtyDaysAgo,
  }).catch(() => ({ data: null }));

  const dau = (dauData as any)?.count ?? 0;
  const mau = (mauData as any)?.count ?? 0;

  // Daily trend for the last 30 days
  const { data: trendData } = await supabaseAdmin
    .from('events')
    .select('created_at, user_id')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at');

  // Aggregate by day
  const dayMap = new Map<string, Set<string>>();
  for (const row of (trendData ?? [])) {
    const day = (row.created_at as string).slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, new Set());
    dayMap.get(day)!.add(row.user_id);
  }

  const dau_trend = Array.from(dayMap.entries())
    .map(([date, users]) => ({ date, count: users.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    dau,
    mau,
    ratio: mau > 0 ? parseFloat((dau / mau).toFixed(3)) : 0,
    dau_trend,
  };
}

// ── ONBOARDING FUNNEL ─────────────────────────────────────────────────────────

async function getOnboardingFunnel(windowStart: string): Promise<FunnelReport> {
  const funnelEvents = [
    'splash_view',
    'auth_attempt',
    'tnc_accepted',
    'kitchen_profile_completed',
    'first_food_logged',
  ];

  const counts: Record<string, number> = {};

  await Promise.all(
    funnelEvents.map(async (eventName) => {
      const { count } = await supabaseAdmin
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('event_name', eventName)
        .gte('created_at', windowStart)
        .then(r => ({ count: r.count ?? 0 }));
      counts[eventName] = count;
    })
  );

  const splash   = counts['splash_view']                 ?? 0;
  const auth     = counts['auth_attempt']                ?? 0;
  const tnc      = counts['tnc_accepted']                ?? 0;
  const profile  = counts['kitchen_profile_completed']   ?? 0;
  const firstLog = counts['first_food_logged']           ?? 0;

  const pct = (n: number, d: number) =>
    d > 0 ? parseFloat((n / d * 100).toFixed(1)) : 0;

  return {
    splash_views:   splash,
    auth_attempts:  auth,
    tnc_accepts:    tnc,
    profiling_done: profile,
    first_log:      firstLog,
    conversion_rates: {
      splash_to_auth:       pct(auth,     splash),
      auth_to_tnc:          pct(tnc,      auth),
      tnc_to_profile:       pct(profile,  tnc),
      profile_to_first_log: pct(firstLog, profile),
      overall:              pct(firstLog, splash),
    },
  };
}

// ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────────

async function getSubscriptionMetrics(): Promise<SubscriptionReport> {
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status');

  const rows = (subs ?? []);

  const active  = rows.filter(r => r.status === 'active' && r.plan === 'pro').length;
  const free    = rows.filter(r => r.plan === 'free').length;
  const grace   = rows.filter(r => r.status === 'grace_period').length;
  const churned = rows.filter(r => r.status === 'cancelled' || r.status === 'expired').length;

  // Grace recovery: % of grace_period subs that became active again
  const { data: webhookEvents } = await supabaseAdmin
    .from('events')
    .select('event_name')
    .in('event_name', ['subscription.charged', 'subscription.charged.failed'])
    .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString());

  const webhookRows = webhookEvents ?? [];
  const totalCharged = webhookRows.filter(e => e.event_name === 'subscription.charged').length;
  const totalFailed  = webhookRows.filter(e => e.event_name === 'subscription.charged.failed').length;
  const totalAttempts = totalCharged + totalFailed;

  const planBreakdown: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.plan}/${row.status}`;
    planBreakdown[key] = (planBreakdown[key] ?? 0) + 1;
  }

  return {
    total_active:   active,
    total_free:     free,
    total_grace:    grace,
    total_churned:  churned,
    mrr:            active * 99,  // ₹99/month × active Pro subscribers
    payment_failure_rate: totalAttempts > 0
      ? parseFloat((totalFailed / totalAttempts * 100).toFixed(1))
      : 0,
    grace_recovery_rate: totalFailed > 0
      ? parseFloat(((totalFailed - grace) / totalFailed * 100).toFixed(1))
      : 100,
    plan_breakdown: Object.entries(planBreakdown).map(([plan, count]) => ({ plan, count })),
  };
}

// ── AI USAGE ──────────────────────────────────────────────────────────────────

async function getAIUsage(windowStart: string, dau: number): Promise<AIUsageReport> {
  const aiEvents = ['ai_search_name', 'ai_search_describe', 'photo_search'];

  const counts: Record<string, number> = {};
  await Promise.all(
    aiEvents.map(async (eventName) => {
      const { count } = await supabaseAdmin
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('event_name', eventName)
        .gte('created_at', windowStart)
        .then(r => ({ count: r.count ?? 0 }));
      counts[eventName] = count;
    })
  );

  const name  = counts['ai_search_name']    ?? 0;
  const desc  = counts['ai_search_describe'] ?? 0;
  const photo = counts['photo_search']       ?? 0;
  const total = name + desc + photo;

  return {
    total_searches:        total,
    name_searches:         name,
    description_searches:  desc,
    photo_searches:        photo,
    ai_search_rate:        dau > 0 ? parseFloat((total / dau * 100).toFixed(1)) : 0,
  };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  // ── Admin check ───────────────────────────────────────────────────────────
  const { data: adminRow } = await supabaseAdmin
    .from('admin_users')
    .select('role')
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (!adminRow) {
    return jsonResponse(403, { error: 'forbidden', message: 'Admin access required' });
  }

  // ── Time frame ────────────────────────────────────────────────────────────
  const rawFrame = event.queryStringParameters?.frame ?? '30d';
  const frame    = (['24h', '7d', '30d', 'ytd'].includes(rawFrame) ? rawFrame : '30d') as TimeFrame;
  const windowStart = getWindowStart(frame);

  // ── Fetch all metrics in parallel ────────────────────────────────────────
  try {
    const [dau_mau, funnel, subscriptions] = await Promise.all([
      getDAUMAU(windowStart),
      getOnboardingFunnel(windowStart),
      getSubscriptionMetrics(),
    ]);

    const ai_usage = await getAIUsage(windowStart, dau_mau.dau);

    const report: AnalyticsReport = {
      generated_at:      new Date().toISOString(),
      time_frame:        frame,
      dau_mau,
      onboarding_funnel: funnel,
      subscriptions,
      ai_usage,
    };

    return jsonResponse(200, report);
  } catch (err) {
    console.error('[analytics] Error:', err);
    return jsonResponse(500, { error: 'internal_error' });
  }
};
