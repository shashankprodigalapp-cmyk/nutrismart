/**
 * netlify/functions/cron-morning-verdict.ts — STRATEGIC REFACTOR R4
 *
 * "The Morning Verdict" — the retention flywheel. One earned insight per
 * morning: yesterday's GL, any crash pattern that repeated, and one concrete
 * suggestion for today. The app that talks first, with something only it knows.
 *
 * TWO INVOCATION MODES:
 *   1. On-login (GET with user JWT): returns the verdict JSON for
 *      VerdictDashboard to render. Cheap — computed per request, ~4 queries.
 *   2. Scheduled (POST with CRON_SECRET header): iterates active users,
 *      computes each verdict, sends VAPID push. Wire via Netlify scheduled
 *      functions (netlify.toml: schedule = "0 2 * * *" — 02:00 UTC = 07:30 IST).
 *
 * Netlify 10s limit: scheduled mode processes max 50 users/invocation and
 * uses a cursor (last processed user id in `user_prefs`-like server table);
 * for launch scale (<1k users) this is plenty. Revisit with a queue at 10k+.
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import webpush from 'web-push';
import {
  verifyJWT,
  supabaseAdmin,
  preflightResponse,
  jsonResponse,
} from './_shared/auth';
import {
  correlateEnergyToFoods,
  getEnergySignalForFood,
  ENERGY_MIN_OBSERVATIONS,
  ENERGY_CRASH_THRESHOLD,
  ENERGY_SUSTAIN_THRESHOLD,
  type FoodEnergyCorrelation,
} from './_shared/energyCorrelation';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface Verdict {
  variant?:        'scientific' | 'coaching';
  date_ist:        string;
  yesterday_gl:    number | null;
  yesterday_cal:   number | null;
  crash_pattern:   string | null;    // "rajma chawal → low energy again (3rd time)"
  streak_note:     string | null;
  suggestion:      string;
  headline:        string;
  /** Phase 2C.4: present when a personalized verdict was generated */
  personalized?:   boolean;
}

// ── PERSONALIZATION CONSTANTS ─────────────────────────────────────────────────

/** Minimum distinct days a meal combination must appear to make a frequency claim */
const PERSONAL_MIN_DAYS        = 3;
/** Lookback window for personalized frequency statements */
const PERSONAL_LOOKBACK_DAYS   = 30;
/** A combination must appear in ≥ this many energy windows to make an energy claim */
const PERSONAL_ENERGY_MIN      = ENERGY_MIN_OBSERVATIONS; // 5 — matches shared algorithm

// ── PERSONALIZATION HELPER ────────────────────────────────────────────────────

interface PersonalizedCopy {
  headline:    string;
  suggestion:  string;
  priority:    1 | 2 | 3 | 4;  // 1 = strongest; used for deterministic selection
}

/**
 * personalizeVerdict — derives personal copy from yesterday's meals + history.
 *
 * PRIORITY ORDER (deterministic, highest evidence wins):
 *   1. Recurring meal (≥3 distinct days) + positive energy association (≥5 obs, crash_rate ≤ 0.40)
 *   2. Recurring meal (≥3 distinct days) + negative energy association (≥5 obs, crash_rate ≥ 0.60)
 *   3. Recurring meal (≥3 distinct days) without energy data
 *   4. Single food with strong energy association (≥5 obs)
 *
 * Returns null when no personalization criteria are met — callers fall back to
 * the existing generic verdict.
 *
 * @param yesterdayLogs   — daily_logs for yesterday (log_date = istDate(-1))
 * @param thirtyDayLogs   — daily_logs for the past 30 days (for frequency counts)
 * @param energyLogs      — energy_logs for the past 60 days (non-skipped)
 * @param variant         — user's A/B copy variant
 */
function personalizeVerdict(
  yesterdayLogs:  Array<{ food_name: string; gl: number; cal: number; meal: string; log_date: string; created_at: string }>,
  thirtyDayLogs:  Array<{ food_name: string; gl: number; meal: string; log_date: string; created_at: string }>,
  energyLogs:     Array<{ level: 'low' | 'steady' | 'high'; log_date: string; created_at: string; skipped?: boolean }>,
  variant:        'scientific' | 'coaching',
): PersonalizedCopy | null {

  if (!yesterdayLogs.length) return null;

  // ── Step 1: Identify yesterday's meals (group by meal slot) ──────────────
  const mealGroups = new Map<string, typeof yesterdayLogs>();
  for (const l of yesterdayLogs) {
    if (!mealGroups.has(l.meal)) mealGroups.set(l.meal, []);
    mealGroups.get(l.meal)!.push(l);
  }

  // Prefer the meal with the most distinct foods (richest combination)
  // Tie-break: lunch > dinner > snack > breakfast (most common meal of interest)
  const MEAL_PRIORITY: Record<string, number> = { lunch: 4, dinner: 3, snack: 2, breakfast: 1 };
  const candidateMeals = [...mealGroups.entries()]
    .filter(([, foods]) => foods.length >= 1)
    .sort((a, b) =>
      b[1].length !== a[1].length
        ? b[1].length - a[1].length
        : (MEAL_PRIORITY[b[0]] ?? 0) - (MEAL_PRIORITY[a[0]] ?? 0)
    );

  if (!candidateMeals.length) return null;

  const [mealSlot, mealFoods] = candidateMeals[0];
  const foodNames = [...new Set(mealFoods.map(f => f.food_name))].sort();
  const canonicalKey = foodNames.join('|');  // sorted, same logic as canonicalKeyFromNames()

  // ── Step 2: Count distinct days this combination appeared (30-day window) ─
  const bySlot = new Map<string, Set<string>>();
  for (const l of thirtyDayLogs) {
    const slotKey = `${l.log_date}|${l.meal}`;
    if (!bySlot.has(slotKey)) bySlot.set(slotKey, new Set());
    bySlot.get(slotKey)!.add(l.food_name);
  }

  let distinctDays = 0;
  for (const [key, foods] of bySlot) {
    const [date, slot] = key.split('|');
    if (slot !== mealSlot) continue;
    // Check if every food in yesterdayFoodNames appears in this slot
    const dayFoods = [...foods].sort();
    const isSubset = foodNames.every(f => dayFoods.includes(f));
    if (isSubset) distinctDays++;
  }

  const isRecurring = distinctDays >= PERSONAL_MIN_DAYS;

  // ── Step 3: Energy correlation (shared algorithm, server reads) ───────────
  const energyResult = correlateEnergyToFoods(thirtyDayLogs, energyLogs);
  const hasSufficientEnergy = energyResult.hasEnoughData;

  // Find the energy signal for each food in yesterday's meal
  let bestEnergyFood: string | null    = null;
  let bestEnergySignal: 'steady' | 'crash' | null = null;
  let bestEnergyObs = 0;

  if (hasSufficientEnergy) {
    for (const name of foodNames) {
      const { signal, total } = getEnergySignalForFood(name, energyResult.correlations);
      if (signal === 'steady_association' && total >= PERSONAL_ENERGY_MIN) {
        if (!bestEnergyFood || total > bestEnergyObs) {
          bestEnergyFood = name; bestEnergySignal = 'steady'; bestEnergyObs = total;
        }
      }
      if (signal === 'low_energy_association' && total >= PERSONAL_ENERGY_MIN) {
        // Only use crash signal if we don't have a steady signal yet
        if (!bestEnergyFood) {
          bestEnergyFood = name; bestEnergySignal = 'crash'; bestEnergyObs = total;
        }
      }
    }
  }

  // ── Step 4: Display names ─────────────────────────────────────────────────
  const comboLabel = foodNames.length <= 3
    ? foodNames.join(' + ')
    : `${foodNames[0]} + ${foodNames.length - 1} more`;

  const dayRange = `in the last ${PERSONAL_LOOKBACK_DAYS} days`;
  const mealLabel = mealSlot.charAt(0).toUpperCase() + mealSlot.slice(1);
  const evidenceStr = `You've had this ${mealSlot} on ${distinctDays} days ${dayRange}.`;

  // ── Step 5: Build copy by priority ───────────────────────────────────────

  // PRIORITY 1: Recurring meal + positive energy association
  if (isRecurring && bestEnergySignal === 'steady') {
    return {
      priority: 1,
      headline: variant === 'scientific'
        ? `${mealLabel} pattern: ${comboLabel}`
        : `Your usual ${mealSlot} is working`,
      suggestion: variant === 'scientific'
        ? `Yesterday's ${mealSlot} — ${comboLabel} — appears in your steadier-energy observations (${bestEnergyObs} check-ins). ${evidenceStr}`
        : `${comboLabel} has become one of your regular ${mealSlot}s, and your logs suggest steadier energy after it. ${evidenceStr}`,
    };
  }

  // PRIORITY 2: Recurring meal + negative energy association
  if (isRecurring && bestEnergySignal === 'crash') {
    return {
      priority: 2,
      headline: variant === 'scientific'
        ? `${mealLabel} pattern: worth watching`
        : `Your ${mealSlot} worth revisiting`,
      suggestion: variant === 'scientific'
        ? `${comboLabel} has appeared ${distinctDays} times at ${mealSlot} — and your logs suggest ${bestEnergyFood} tends to show up in your lower-energy windows (${bestEnergyObs} check-ins). Worth exploring a swap.`
        : `Your logs suggest ${bestEnergyFood} at ${mealSlot} often shows up before lower-energy afternoons. Your call — but maybe worth trying something lighter? ${evidenceStr}`,
    };
  }

  // PRIORITY 3: Recurring meal without energy signal
  if (isRecurring) {
    return {
      priority: 3,
      headline: variant === 'scientific'
        ? `Recurring pattern: ${comboLabel}`
        : `Your usual ${mealSlot}`,
      suggestion: variant === 'scientific'
        ? `${comboLabel} has become one of your regular ${mealSlot} combinations. ${evidenceStr} Log your energy ~60 min after eating to build a clearer picture.`
        : `${comboLabel} at ${mealSlot} — you've been coming back to this one. ${evidenceStr} Add an energy check-in after lunch today to see how it lands.`,
    };
  }

  // PRIORITY 4: Single food with energy signal (but meal not recurring enough)
  if (bestEnergyFood && bestEnergySignal) {
    const signalPhrase = bestEnergySignal === 'steady'
      ? 'appears in your steadier-energy windows'
      : 'tends to show up before lower-energy periods';
    return {
      priority: 4,
      headline: variant === 'scientific'
        ? `Energy signal: ${bestEnergyFood}`
        : `Worth knowing about ${bestEnergyFood}`,
      suggestion: variant === 'scientific'
        ? `Your logs suggest ${bestEnergyFood} ${signalPhrase} (${bestEnergyObs} check-ins). Keep logging energy after meals — the pattern sharpens with more observations.`
        : `Your logs suggest ${bestEnergyFood} ${signalPhrase}. Not a guarantee — just what your data shows so far across ${bestEnergyObs} check-ins.`,
    };
  }

  return null;  // no personalization criteria met → caller uses generic verdict
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

const istDate = (offsetDays = 0): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
};

async function computeVerdict(userId: string): Promise<Verdict | null> {
  const yesterday = istDate(-1);
  const weekAgo   = istDate(-7);
  const thirtyAgo = istDate(-30);

  // Parallel: yesterday's logs, week's logs+energy, 30-day logs for personalization
  const [yLogsRes, wLogsRes, wEnergyRes, tLogsRes] = await Promise.all([
    supabaseAdmin.from('daily_logs')
      .select('food_name, gl, cal, meal, created_at')
      .eq('user_id', userId).eq('log_date', yesterday),
    supabaseAdmin.from('daily_logs')
      .select('food_name, gl, log_date, created_at')
      .eq('user_id', userId).gte('log_date', weekAgo),
    supabaseAdmin.from('energy_logs')
      .select('level, log_date, created_at')
      .eq('user_id', userId).gte('log_date', weekAgo)
      .eq('skipped', false),      // Phase 2B.1: exclude skipped check-ins from crash pattern
    supabaseAdmin.from('daily_logs')
      .select('food_name, gl, meal, log_date, created_at')
      .eq('user_id', userId).gte('log_date', thirtyAgo),
  ]);

  const yLogs   = (yLogsRes.data ?? []) as Array<{ food_name: string; gl: number; cal: number; meal: string; created_at: string; log_date?: string }>;
  // Add log_date to yLogs entries (it's yesterday — needed by personalizeVerdict)
  const yLogsWithDate = yLogs.map(l => ({ ...l, log_date: yesterday }));
  const wLogs   = wLogsRes.data ?? [];
  const wEnergy = wEnergyRes.data ?? [];
  const tLogs   = tLogsRes.data ?? [];

  // Nothing logged yesterday and thin week → no verdict (don't send noise)
  if (!yLogsWithDate.length && wLogs.length < 5) return null;

  const yGL  = yLogsWithDate.length ? Math.round(yLogsWithDate.reduce((s, l) => s + (l.gl ?? 0), 0)) : null;
  const yCal = yLogsWithDate.length ? Math.round(yLogsWithDate.reduce((s, l) => s + (l.cal ?? 0), 0)) : null;

  // Crash pattern: foods appearing 60–90 min before 'low' energy, ≥2 times this week
  const crashCounts = new Map<string, number>();
  for (const e of wEnergy.filter(e => e.level === 'low')) {
    const eTime = new Date(e.created_at).getTime();
    const prior = wLogs.filter(l => {
      if (l.log_date !== e.log_date) return false;
      const lt = new Date(l.created_at).getTime();
      return lt >= eTime - 90 * 60_000 && lt <= eTime - 60 * 60_000;
    });
    for (const l of prior) {
      crashCounts.set(l.food_name, (crashCounts.get(l.food_name) ?? 0) + 1);
    }
  }
  const topCrash = [...crashCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])[0];

  const crash_pattern = topCrash
    ? `${topCrash[0]} → low energy again (${topCrash[1]} times this week)`
    : null;

  // ── A/B VARIANTS (growth task 2.1) ─────────────────────────────────────
  // Sticky per-user assignment via users.verdict_variant (hash of id, set in
  // migration 008). Two tones testing the same information:
  //   scientific — mechanism-first, numbers up front ("data respects me")
  //   coaching   — warmth-first, second person ("someone's in my corner")
  // Every push/view event carries the variant so opens can be split in
  // AnalyticsDashboard: open-rate = app_opened_from_verdict / verdict_sent, per variant.
  const { data: userRow } = await supabaseAdmin
    .from('users').select('verdict_variant').eq('id', userId).maybeSingle();
  const variant: 'scientific' | 'coaching' =
    userRow?.verdict_variant === 'coaching' ? 'coaching' : 'scientific';

  let suggestion: string;
  let headline:   string;

  if (crash_pattern && topCrash) {
    if (variant === 'scientific') {
      headline   = `Pattern detected: ${topCrash[0]}`;
      suggestion = `${topCrash[1]}× this week: ${topCrash[0]} → energy dip within 90 min. High-GL meals spike then crash blood glucose. A lower-GL lunch swap breaks the cycle.`;
    } else {
      headline   = `${topCrash[0]} strikes again`;
      suggestion = `We noticed your afternoons keep dipping after ${topCrash[0]}. You're so close to cracking this — try one lighter lunch today and see how 3pm feels.`;
    }
  } else if (yGL !== null && yGL > 45) {
    if (variant === 'scientific') {
      headline   = `Yesterday: GL ${yGL} (target <45)`;
      suggestion = `Glycemic load ran ${yGL - 45} points over. Protein at breakfast slows glucose absorption — front-load it to flatten today's curve.`;
    } else {
      headline   = `Yesterday ran a little high — no stress`;
      suggestion = `GL ${yGL} happens to everyone. Today's a clean slate: a protein-rich breakfast is the easiest win, and you've done it plenty of times before.`;
    }
  } else if (yGL !== null) {
    if (variant === 'scientific') {
      headline   = `Steady day: GL ${yGL} ✓`;
      suggestion = `Yesterday stayed in the stable zone. Consistent GL under 45 is the strongest predictor of steady afternoon energy. Repeat the formula.`;
    } else {
      headline   = `You nailed yesterday 🎯`;
      suggestion = `GL ${yGL} — that's the groove. Whatever you did yesterday, your body thanked you for it. Same rhythm today.`;
    }
  } else {
    if (variant === 'scientific') {
      headline   = `Data gap: yesterday`;
      suggestion = `No logs = no insight. One complete day of logging generates your next crash-pattern analysis.`;
    } else {
      headline   = `Fresh start today`;
      suggestion = `Yesterday got away from you — it happens. One honest day of logging beats a week of guessing, and it starts with breakfast.`;
    }
  }

  // ── PHASE 2C.4: PERSONALIZATION LAYER ──────────────────────────────────────
  // Attempt to generate personalized copy from yesterday's meals + history.
  // If personalization criteria are met, it REPLACES the generic headline and
  // suggestion. All other fields (GL, cal, crash_pattern) are preserved.
  //
  // 60-day energy logs are fetched from wEnergy (7-day) PLUS the 30-day tLogs
  // window provides the food context. For the energy correlation we fetch a
  // 60-day energy window separately to give the algorithm its proper floor.
  let personalized = false;
  {
    // Fetch 60-day energy logs (personalizeVerdict uses the shared algorithm
    // which requires 60 days, not just the 7-day wEnergy window)
    const { data: energyData60 } = await supabaseAdmin
      .from('energy_logs')
      .select('level, log_date, created_at')
      .eq('user_id', userId)
      .gte('log_date', istDate(-60))
      .eq('skipped', false);

    const personal = personalizeVerdict(
      yLogsWithDate,
      tLogs,                    // 30-day food logs for frequency
      energyData60 ?? [],       // 60-day energy logs for correlation
      variant,
    );

    if (personal) {
      headline   = personal.headline;
      suggestion = personal.suggestion;
      personalized = true;
    }
  }

  // ── COMMUNITY BENCHMARK (gamification task 3) ──────────────────────────
  // Purely aggregated — the RPC returns only the user's own rank against an
  // anonymous distribution, and refuses below 20 active users. Appended as a
  // single sentence; never replaces the personal insight (rank is a garnish,
  // the crash pattern is the meal).
  let community_note: string | null = null;
  try {
    const { data: pct } = await supabaseAdmin.rpc('get_user_percentile', {
      p_user_id: userId,
    });
    if (pct?.sufficient && typeof pct.better_than === 'number' && pct.better_than >= 50) {
      community_note = variant === 'scientific'
        ? `Yesterday's GL placed you ahead of ${pct.better_than}% of NutriSmart users.`
        : `And here's the kicker — you ate better than ${pct.better_than}% of the community yesterday. 👏`;
      suggestion = `${suggestion} ${community_note}`;
    }
    // Below-median ranks are deliberately NOT sent — "you ate worse than 70%
    // of users" is a churn notification, not a gamification one.
  } catch { /* benchmark is a garnish — never block the verdict */ }

  return {
    date_ist:      istDate(0),
    yesterday_gl:  yGL,
    yesterday_cal: yCal,
    crash_pattern,
    streak_note:   community_note,
    suggestion,
    headline,
    variant,
    personalized,  // Phase 2C.4: true when personalized copy was used
  };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  // ── MODE 1: on-login fetch (user JWT) ─────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const auth = await verifyJWT(event);
    if (!auth) return jsonResponse(401, { error: 'unauthorized' });

    const verdict = await computeVerdict(auth.userId);
    return jsonResponse(200, { success: true, verdict });
  }

  // ── MODE 2: scheduled push run (CRON_SECRET) ──────────────────────────────
  if (event.httpMethod === 'POST') {
    const secret = event.headers['x-cron-secret'];
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

    // Users active in the last 7 days with a push subscription (cap 50/run)
    const weekAgo = istDate(-7);
    const { data: activeUsers } = await supabaseAdmin
      .from('daily_logs')
      .select('user_id')
      .gte('log_date', weekAgo)
      .limit(2000);

    const uniqueIds = [...new Set((activeUsers ?? []).map(u => u.user_id))].slice(0, 50);

    let sent = 0, skipped = 0;
    for (const uid of uniqueIds) {
      const verdict = await computeVerdict(uid);
      if (!verdict) { skipped++; continue; }

      const { data: subs } = await supabaseAdmin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key')
        .eq('user_id', uid);

      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            JSON.stringify({
              title: `☀️ ${verdict.headline}`,
              body:  verdict.suggestion,
              tag:   `verdict-${verdict.date_ist}`,
              url:   `/app/log?source=verdict&variant=${verdict.variant ?? 'scientific'}`,
            }),
          );
          sent++;
          // A/B accounting: open-rate denominator, split by variant
          await supabaseAdmin.from('events').insert({
            user_id:    uid,
            event_name: 'verdict_sent',
            properties: { variant: verdict.variant, headline: verdict.headline },
            created_at: new Date().toISOString(),
          });
        } catch (err: any) {
          // 410 Gone = dead subscription — clean it up
          if (err?.statusCode === 410) {
            await supabaseAdmin.from('push_subscriptions')
              .delete().eq('endpoint', s.endpoint);
          }
        }
      }
    }

    // ── RE-ENGAGEMENT PASS (growth task 3.2) ──────────────────────────────
    // Users logging food daily but blind to the verdict for 3 straight days:
    // the flywheel isn't spinning for them. One low-effort nudge anchored to
    // their own most recent food — familiarity minimizes activation energy.
    let reengaged = 0;
    const { data: atRisk } = await supabaseAdmin.rpc('retention_health_check', {
      p_since_days: 3,
    });

    for (const u of (atRisk ?? []).filter((r: any) => r.needs_reengagement).slice(0, 25)) {
      // CONSTRAINT: respect user quiet hours — a re-engagement nudge that
      // wakes someone up creates churn, not retention. Server-side check
      // handles the midnight-wrapping window (22:00 → 07:00 IST).
      const { data: isQuiet } = await supabaseAdmin.rpc('is_quiet_hours', {
        p_user_id: u.user_id,
      });
      if (isQuiet === true) { continue; }

      const { data: subs } = await supabaseAdmin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key')
        .eq('user_id', u.user_id);

      const foodHook = u.last_food_logged
        ? `Logging ${u.last_food_logged} again today? One tap and you're done —`
        : `One tap is all today needs —`;

      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            JSON.stringify({
              title: `👀 Your verdict's been waiting`,
              body:  `${foodHook} and your morning insight is already on the dashboard.`,
              tag:   `reengage-${istDate(0)}`,
              url:   '/app/log?source=reengage',
            }),
          );
          reengaged++;
          await supabaseAdmin.from('events').insert({
            user_id:    u.user_id,
            event_name: 'reengagement_sent',
            properties: { days_ignored: 3, hook_food: u.last_food_logged },
            created_at: new Date().toISOString(),
          });
        } catch (err: any) {
          if (err?.statusCode === 410) {
            await supabaseAdmin.from('push_subscriptions')
              .delete().eq('endpoint', s.endpoint);
          }
        }
      }
    }

    return jsonResponse(200, { success: true, processed: uniqueIds.length, sent, skipped, reengaged });
  }

  return jsonResponse(405, { error: 'method_not_allowed' });
};
