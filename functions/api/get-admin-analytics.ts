import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';

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
  dau_trend: Array<{ date: string; count: number }>;
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
  mrr:            number;
  payment_failure_rate: number;
  grace_recovery_rate:  number;
  plan_breakdown: { plan: string; count: number }[];
}

interface AIUsageReport {
  total_searches:     number;
  name_searches:      number;
  description_searches: number;
  photo_searches:     number;
  ai_search_rate:     number;
}

function getWindowStart(frame: TimeFrame): string {
  const now = new Date();
  switch (frame) {
    case '24h': return new Date(now.getTime() - 86_400_000).toISOString();
    case '7d':  return new Date(now.getTime() - 7 * 86_400_000).toISOString();
    case '30d': return new Date(now.getTime() - 30 * 86_400_000).toISOString();
    case 'ytd': return new Date(now.getFullYear(), 0, 1).toISOString();
  }
}

async function getDAUMAU(env: Env, windowStart: string): Promise<DAUMAUReport> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  let dauData: unknown = null;
  let mauData: unknown = null;
  try {
    const r = await supabaseAdmin.rpc('count_distinct_users_since', {
      p_since: new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
    });
    dauData = r.data;
  } catch { /* fall through with null */ }
  try {
    const r = await supabaseAdmin.rpc('count_distinct_users_since', {
      p_since: thirtyDaysAgo,
    });
    mauData = r.data;
  } catch { /* fall through with null */ }

  const dau = (dauData as any)?.count ?? 0;
  const mau = (mauData as any)?.count ?? 0;

  const { data: trendData } = await supabaseAdmin
    .from('events')
    .select('created_at, user_id')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at');

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

async function getOnboardingFunnel(env: Env, windowStart: string): Promise<FunnelReport> {
  const supabaseAdmin = getSupabaseAdmin(env);
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

async function getSubscriptionMetrics(env: Env): Promise<SubscriptionReport> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status');

  const rows = (subs ?? []);

  const active  = rows.filter(r => r.status === 'active' && r.plan === 'pro').length;
  const { count: freeUsers } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('plan', 'free');
  const free    = freeUsers ?? rows.filter(r => r.plan === 'free').length;
  const grace   = rows.filter(r => r.status === 'grace_period').length;
  const churned = rows.filter(r => r.status === 'cancelled' || r.status === 'expired').length;

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
    mrr:            active * 99,
    payment_failure_rate: totalAttempts > 0
      ? parseFloat((totalFailed / totalAttempts * 100).toFixed(1))
      : 0,
    grace_recovery_rate: totalFailed > 0
      ? parseFloat(((totalFailed - grace) / totalFailed * 100).toFixed(1))
      : 100,
    plan_breakdown: Object.entries(planBreakdown).map(([plan, count]) => ({ plan, count })),
  };
}

async function getAIUsage(env: Env, windowStart: string, dau: number): Promise<AIUsageReport> {
  const supabaseAdmin = getSupabaseAdmin(env);
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

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  const supabaseAdmin = getSupabaseAdmin(env);
  const { data: adminRow } = await supabaseAdmin
    .from('admin_users')
    .select('role')
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (!adminRow) {
    return jsonResponse(env, 403, { error: 'forbidden', message: 'Admin access required' });
  }

  const url = new URL(request.url);
  const rawFrame = url.searchParams.get('frame') ?? '30d';
  const frame = (['24h', '7d', '30d', 'ytd'].includes(rawFrame) ? rawFrame : '30d') as TimeFrame;
  const windowStart = getWindowStart(frame);

  try {
    const [dau_mau, funnel, subscriptions] = await Promise.all([
      getDAUMAU(env, windowStart),
      getOnboardingFunnel(env, windowStart),
      getSubscriptionMetrics(env),
    ]);

    const ai_usage = await getAIUsage(env, windowStart, dau_mau.dau);

    const report: AnalyticsReport = {
      generated_at:      new Date().toISOString(),
      time_frame:        frame,
      dau_mau,
      onboarding_funnel: funnel,
      subscriptions,
      ai_usage,
    };

    return jsonResponse(env, 200, report);
  } catch (err) {
    console.error('[analytics] Error:', err);
    return jsonResponse(env, 500, { error: 'internal_error' });
  }
};
