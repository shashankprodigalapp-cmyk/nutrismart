/**
 * netlify/functions/energy-checkin-cron.ts — Energy Check-In Push Reminder
 *
 * SCHEDULE: every 30 minutes (*(/30 * * * *)
 * Configured in netlify.toml:
 *   [functions."energy-checkin-cron"]
 *   schedule = "\/30 * * * *"
 *
 * PHASE 2B.2 — MEAL-LEVEL MATCHING
 *
 * State is evaluated per (user_id + log_date + meal), not per user.
 * This means:
 *   Lunch skipped  → Lunch suppressed, Snack still eligible
 *   Snack answered → Snack suppressed, Dinner still eligible
 *   Dinner pending → Dinner notified
 *
 * MATCHING RULE:
 *   Candidate = daily_log row with created_at in [now-90min, now-60min]
 *   Acted    = energy_logs row with same (user_id + log_date + meal_before)
 *   Pending  = candidate with NO matching energy_logs row
 *
 * The join key:
 *   daily_logs.meal  =  energy_logs.meal_before
 * Both carry values: 'breakfast' | 'lunch' | 'snack' | 'dinner'
 * EnergyCheckIn sets meal_before = current.meal (the PendingCheckIn.meal field).
 *
 * NOTIFICATION TAG (dedup):
 *   tag = `energy-checkin-${userId.slice(0,8)}-${log_date}-${meal}`
 *   Uses the meal name, not the UTC hour — fully deterministic regardless of
 *   when in the 30-min window the cron fires. Same tag = browser replaces,
 *   not stacks.
 *
 * REMAINING LIMITATION:
 *   If the user skips offline, the skipped row is in Dexie but not yet synced.
 *   One push may be sent before the row syncs. This is the irreducible minimum.
 *
 * SECURITY:
 *   - Requires CRON_SECRET header
 *   - VAPID keys from env vars
 *   - Push payload contains no nutrition data
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import webpush from 'web-push';
import {
  supabaseAdmin,
  preflightResponse,
  jsonResponse,
} from './_shared/auth';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const WINDOW_MIN_MINUTES = 60;
const WINDOW_MAX_MINUTES = 90;
const MAX_CANDIDATES     = 200;  // daily_log rows in window (before dedup)

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  const secret = event.headers['x-cron-secret'] ?? event.headers['X-Cron-Secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonResponse(403, { error: 'forbidden' });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return jsonResponse(500, { error: 'vapid_not_configured' });
  }
  webpush.setVapidDetails(
    'mailto:support@nutrismart.in',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  const now         = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MAX_MINUTES * 60_000);
  const windowEnd   = new Date(now.getTime() - WINDOW_MIN_MINUTES * 60_000);

  // ── Step 1: Find meal candidates ──────────────────────────────────────────
  // Daily log rows whose created_at falls in the 60–90 min window.
  // These are the meals we need to check for pending check-ins.
  const { data: recentLogs } = await supabaseAdmin
    .from('daily_logs')
    .select('user_id, log_date, meal')
    .gte('created_at', windowStart.toISOString())
    .lte('created_at', windowEnd.toISOString())
    .limit(MAX_CANDIDATES);

  if (!recentLogs?.length) {
    return jsonResponse(200, { success: true, sent: 0, skipped: 0, reason: 'no_recent_loggers' });
  }

  // Deduplicate: one candidate per (user_id, log_date, meal).
  // Multiple foods logged to the same meal produce one candidate.
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

  // ── Step 2: Fetch energy_logs for all candidate users ─────────────────────
  // We fetch all energy_logs rows for these users that have a meal_before value
  // matching one of the candidate meals. No time filter — we want to catch
  // skips that happened before the current cron window too.
  const candidateUserIds = [...new Set(candidates.map(c => c.user_id))];

  const { data: energyLogs } = await supabaseAdmin
    .from('energy_logs')
    .select('user_id, log_date, meal_before, skipped')
    .in('user_id', candidateUserIds)
    .in('meal_before', ['breakfast', 'lunch', 'snack', 'dinner'])
    // Only today's rows are relevant (candidates all have today's log_date)
    .gte('log_date', windowStart.toISOString().slice(0, 10));

  // ── Step 3: Build a per-meal acted set ────────────────────────────────────
  // Key: `${user_id}|${log_date}|${meal_before}` — same shape as candidates.
  // ANY energy_log row for this meal (answered OR skipped) = acted.
  const mealActed = new Set<string>(
    (energyLogs ?? []).map(e => `${e.user_id}|${e.log_date}|${e.meal_before}`),
  );

  // ── Step 4: Filter to pending candidates ─────────────────────────────────
  const pending = candidates.filter(c => {
    const key = `${c.user_id}|${c.log_date}|${c.meal}`;
    return !mealActed.has(key);
  });

  if (!pending.length) {
    return jsonResponse(200, {
      success: true, sent: 0, skipped: candidates.length,
      reason: 'all_meals_answered_or_skipped',
    });
  }

  // ── Step 5: Send push notifications ───────────────────────────────────────
  let sent = 0;
  let skipped = 0;

  // Cache subscriptions by user_id (avoid re-fetching for multi-meal users)
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

    // Tag: deterministic per (user, date, meal) — cron runs twice won't stack
    const tag = `energy-checkin-${candidate.user_id.slice(0, 8)}-${candidate.log_date}-${candidate.meal}`;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({
            title: 'How\'s your energy?',
            body:  'It\'s been about an hour since your meal. Take a quick energy check-in.',
            tag,
            url:   '/app/log',
          }),
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 410) {
          await supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        }
        skipped++;
      }
    }
  }

  return jsonResponse(200, {
    success: true,
    sent,
    skipped,
    window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
  });
};
