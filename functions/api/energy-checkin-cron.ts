import type { Env } from '../_shared/auth';
import {
  getSupabaseAdmin,
  preflightResponse,
  jsonResponse,
} from '../_shared/auth';
import { sendWebPush } from '../_shared/webPush';

const WINDOW_MIN_MINUTES = 60;
const WINDOW_MAX_MINUTES = 90;
const MAX_CANDIDATES     = 200;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);

  const secret = request.headers.get('x-cron-secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return jsonResponse(env, 403, { error: 'forbidden' });
  }

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return jsonResponse(env, 500, { error: 'vapid_not_configured' });
  }

  const supabaseAdmin = getSupabaseAdmin(env);

  const now         = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MAX_MINUTES * 60_000);
  const windowEnd   = new Date(now.getTime() - WINDOW_MIN_MINUTES * 60_000);

  const { data: recentLogs } = await supabaseAdmin
    .from('daily_logs')
    .select('user_id, log_date, meal')
    .gte('created_at', windowStart.toISOString())
    .lte('created_at', windowEnd.toISOString())
    .limit(MAX_CANDIDATES);

  if (!recentLogs?.length) {
    return jsonResponse(env, 200, { success: true, sent: 0, skipped: 0, reason: 'no_recent_loggers' });
  }

  type MealCandidate = { user_id: string; log_date: string; meal: string };
  const seen = new Set<string>();
  const candidates: MealCandidate[] = [];

  for (const row of recentLogs) {
    const key = `${row.user_id}|${row.log_date}|${row.meal}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ user_id: row.user_id, log_date: row.log_date, meal: row.meal });
    }
  }

  const candidateUserIds = [...new Set(candidates.map(c => c.user_id))];

  const { data: energyLogs } = await supabaseAdmin
    .from('energy_logs')
    .select('user_id, log_date, meal_before, skipped')
    .in('user_id', candidateUserIds)
    .in('meal_before', ['breakfast', 'lunch', 'snack', 'dinner'])
    .gte('log_date', windowStart.toISOString().slice(0, 10));

  const mealActed = new Set<string>(
    (energyLogs ?? []).map((e: any) => `${e.user_id}|${e.log_date}|${e.meal_before}`),
  );

  const pending = candidates.filter(c => {
    const key = `${c.user_id}|${c.log_date}|${c.meal}`;
    return !mealActed.has(key);
  });

  if (!pending.length) {
    return jsonResponse(env, 200, {
      success: true, sent: 0, skipped: candidates.length,
      reason: 'all_meals_answered_or_skipped',
    });
  }

  let sent = 0;
  let skipped = 0;

  const subCache = new Map<string, Array<{ endpoint: string; p256dh: string; auth_key: string }>>();

  for (const candidate of pending) {
    let subs = subCache.get(candidate.user_id);
    if (!subs) {
      const { data } = await supabaseAdmin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key')
        .eq('user_id', candidate.user_id);
      subs = data ?? [];
      subCache.set(candidate.user_id, subs);
    }

    if (!subs.length) { skipped++; continue; }

    const tag = `energy-checkin-${candidate.user_id.slice(0, 8)}-${candidate.log_date}-${candidate.meal}`;

    for (const sub of subs) {
      try {
        const { ok, status } = await sendWebPush(env, sub, {
          title: 'How\'s your energy?',
          body:  'It\'s been about an hour since your meal. Take a quick energy check-in.',
          tag,
          url:   '/app/log?source=checkin',
        });
        if (ok) {
          sent++;
        } else {
          if (status === 410) {
            await supabaseAdmin
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', sub.endpoint);
          }
          skipped++;
        }
      } catch {
        skipped++;
      }
    }
  }

  return jsonResponse(env, 200, {
    success: true,
    sent,
    skipped,
    window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
  });
};
