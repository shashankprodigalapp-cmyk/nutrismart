import type { Env } from '../_shared/auth';
import {
  verifyJWT,
  getSupabaseAdmin,
  preflightResponse,
  jsonResponse,
} from '../_shared/auth';
import {
  correlateEnergyToFoods,
  getEnergySignalForFood,
  ENERGY_MIN_OBSERVATIONS,
} from '../_shared/energyCorrelation';
import { sendWebPush } from '../_shared/webPush';

interface Verdict {
  variant?:        'scientific' | 'coaching';
  date_ist:        string;
  yesterday_gl:    number | null;
  yesterday_cal:   number | null;
  crash_pattern:   string | null;
  streak_note:     string | null;
  suggestion:      string;
  headline:        string;
  personalized?:   boolean;
}

const PERSONAL_MIN_DAYS        = 3;
const PERSONAL_LOOKBACK_DAYS   = 30;
const PERSONAL_ENERGY_MIN      = ENERGY_MIN_OBSERVATIONS;

interface PersonalizedCopy {
  headline:    string;
  suggestion:  string;
  priority:    1 | 2 | 3 | 4;
}

function personalizeVerdict(
  yesterdayLogs:  Array<{ food_name: string; gl: number; cal: number; meal: string; log_date: string; created_at: string }>,
  thirtyDayLogs:  Array<{ food_name: string; gl: number; meal: string; log_date: string; created_at: string }>,
  energyLogs:     Array<{ level: 'low' | 'steady' | 'high'; log_date: string; created_at: string; skipped?: boolean }>,
  variant:        'scientific' | 'coaching',
): PersonalizedCopy | null {

  if (!yesterdayLogs.length) return null;

  const mealGroups = new Map<string, typeof yesterdayLogs>();
  for (const l of yesterdayLogs) {
    if (!mealGroups.has(l.meal)) mealGroups.set(l.meal, []);
    mealGroups.get(l.meal)!.push(l);
  }

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
    const dayFoods = [...foods].sort();
    const isSubset = foodNames.every(f => dayFoods.includes(f));
    if (isSubset) distinctDays++;
  }

  const isRecurring = distinctDays >= PERSONAL_MIN_DAYS;

  const energyResult = correlateEnergyToFoods(thirtyDayLogs, energyLogs);
  const hasSufficientEnergy = energyResult.hasEnoughData;

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
        if (!bestEnergyFood) {
          bestEnergyFood = name; bestEnergySignal = 'crash'; bestEnergyObs = total;
        }
      }
    }
  }

  const comboLabel = foodNames.length <= 3
    ? foodNames.join(' + ')
    : `${foodNames[0]} + ${foodNames.length - 1} more`;

  const dayRange = `in the last ${PERSONAL_LOOKBACK_DAYS} days`;
  const mealLabel = mealSlot.charAt(0).toUpperCase() + mealSlot.slice(1);
  const evidenceStr = `You've had this ${mealSlot} on ${distinctDays} days ${dayRange}.`;

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

  return null;
}

const istDate = (offsetDays = 0): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
};

async function computeVerdict(env: Env, userId: string): Promise<Verdict | null> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const yesterday = istDate(-1);
  const weekAgo   = istDate(-7);
  const thirtyAgo = istDate(-30);

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
      .eq('skipped', false),
    supabaseAdmin.from('daily_logs')
      .select('food_name, gl, meal, log_date, created_at')
      .eq('user_id', userId).gte('log_date', thirtyAgo),
  ]);

  const yLogs   = (yLogsRes.data ?? []) as Array<{ food_name: string; gl: number; cal: number; meal: string; created_at: string; log_date?: string }>;
  const yLogsWithDate = yLogs.map(l => ({ ...l, log_date: yesterday }));
  const wLogs   = wLogsRes.data ?? [];
  const wEnergy = wEnergyRes.data ?? [];
  const tLogs   = tLogsRes.data ?? [];

  if (!yLogsWithDate.length && wLogs.length < 5) return null;

  const yGL  = yLogsWithDate.length ? Math.round(yLogsWithDate.reduce((s, l) => s + (l.gl ?? 0), 0)) : null;
  const yCal = yLogsWithDate.length ? Math.round(yLogsWithDate.reduce((s, l) => s + (l.cal ?? 0), 0)) : null;

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

  let personalized = false;
  {
    const { data: energyData60 } = await supabaseAdmin
      .from('energy_logs')
      .select('level, log_date, created_at')
      .eq('user_id', userId)
      .gte('log_date', istDate(-60))
      .eq('skipped', false);

    const personal = personalizeVerdict(
      yLogsWithDate,
      tLogs,
      energyData60 ?? [],
      variant,
    );

    if (personal) {
      headline   = personal.headline;
      suggestion = personal.suggestion;
      personalized = true;
    }
  }

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
    personalized,
  };
}

async function handleScheduledRun(env: Env): Promise<Response> {
  const supabaseAdmin = getSupabaseAdmin(env);

  const weekAgo = istDate(-7);
  const { data: activeUsers } = await supabaseAdmin
    .from('daily_logs')
    .select('user_id')
    .gte('log_date', weekAgo)
    .limit(2000);

  const uniqueIds = [...new Set((activeUsers ?? []).map((u: any) => u.user_id))].slice(0, 50);

  let sent = 0, skipped = 0;
  for (const uid of uniqueIds as string[]) {
    const verdict = await computeVerdict(env, uid);
    if (!verdict) { skipped++; continue; }

    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key')
      .eq('user_id', uid);

    for (const s of subs ?? []) {
      try {
        const { ok, status } = await sendWebPush(env, s, {
          title: `☀️ ${verdict.headline}`,
          body:  verdict.suggestion,
          tag:   `verdict-${verdict.date_ist}`,
          url:   `/app/log?source=verdict&variant=${verdict.variant ?? 'scientific'}`,
        });
        if (ok) {
          sent++;
          await supabaseAdmin.from('events').insert({
            user_id:    uid,
            event_name: 'verdict_sent',
            properties: { variant: verdict.variant, headline: verdict.headline },
            created_at: new Date().toISOString(),
          });
        } else if (status === 410) {
          await supabaseAdmin.from('push_subscriptions')
            .delete().eq('endpoint', s.endpoint);
        }
      } catch { /* non-fatal — one bad subscription shouldn't break the run */ }
    }
  }

  let reengaged = 0;
  const { data: atRisk } = await supabaseAdmin.rpc('retention_health_check', {
    p_since_days: 3,
  });

  for (const u of (atRisk ?? []).filter((r: any) => r.needs_reengagement).slice(0, 25)) {
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
        const { ok, status } = await sendWebPush(env, s, {
          title: `👀 Your verdict's been waiting`,
          body:  `${foodHook} and your morning insight is already on the dashboard.`,
          tag:   `reengage-${istDate(0)}`,
          url:   '/app/log?source=reengage',
        });
        if (ok) {
          reengaged++;
          await supabaseAdmin.from('events').insert({
            user_id:    u.user_id,
            event_name: 'reengagement_sent',
            properties: { days_ignored: 3, hook_food: u.last_food_logged },
            created_at: new Date().toISOString(),
          });
        } else if (status === 410) {
          await supabaseAdmin.from('push_subscriptions')
            .delete().eq('endpoint', s.endpoint);
        }
      } catch { /* non-fatal */ }
    }
  }

  return jsonResponse(env, 200, { success: true, processed: uniqueIds.length, sent, skipped, reengaged });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);

  if (request.method === 'GET') {
    const auth = await verifyJWT(request, env);
    if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

    const verdict = await computeVerdict(env, auth.userId);
    return jsonResponse(env, 200, { success: true, verdict });
  }

  if (request.method === 'POST') {
    const secret = request.headers.get('x-cron-secret');
    if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
      return jsonResponse(env, 403, { error: 'forbidden' });
    }
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return jsonResponse(env, 500, { error: 'vapid_not_configured' });
    }
    return handleScheduledRun(env);
  }

  return jsonResponse(env, 405, { error: 'method_not_allowed' });
};
