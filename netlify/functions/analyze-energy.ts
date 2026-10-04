/**
 * netlify/functions/analyze-energy.ts — TASK 2: Biological Intelligence
 *
 * Correlates what the user ate with how they felt afterwards.
 *
 * METHOD:
 *   1. Pull last 60 days of daily_logs + energy_logs for the user.
 *   2. For each energy log, find the meal window 60–90 minutes prior
 *      (energy_logs.logged_at minus 60–90 min, matched against
 *       daily_logs.created_at on the same IST date).
 *   3. 'low' energy → attribute to foods in that prior window ("crash triggers")
 *      'steady'/'high' → attribute to foods in that window ("sustainers")
 *   4. Aggregate per food: crash_count, sustain_count, avg preceding meal GL.
 *   5. STATISTICAL FLOOR: any food with < 5 total correlated observations
 *      is excluded — too little data to claim a pattern (coding constraint).
 *
 * Returns ranked lists + the user's average "crash meal GL" vs "steady meal GL"
 * so the UI can show the GL gap ("your crashes follow meals averaging GL 38;
 * your steady afternoons follow GL 19").
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  verifyJWT,
  supabaseAdmin,
  preflightResponse,
  jsonResponse,
} from './_shared/auth';
import {
  ENERGY_LOOKBACK_DAYS      as LOOKBACK_DAYS,
  ENERGY_WINDOW_MIN_MIN     as WINDOW_MIN_MINUTES,
  ENERGY_WINDOW_MAX_MIN     as WINDOW_MAX_MINUTES,
  ENERGY_MIN_OBSERVATIONS   as MIN_OBSERVATIONS,
  ENERGY_CRASH_THRESHOLD,
  ENERGY_SUSTAIN_THRESHOLD,
} from './_shared/energyCorrelation';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

// Constants imported from ./_shared/energyCorrelation (single source of truth)
const MAX_RESULTS_PER_SIDE = 6;

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface LogRow {
  id:         string;
  food_name:  string;
  gl:         number;
  cal:        number;
  meal:       string;
  log_date:   string;
  created_at: string;
}

interface EnergyRow {
  id:         string;
  level:      'low' | 'steady' | 'high';
  log_date:   string;
  created_at: string;
  skipped:    boolean;   // Phase 2B.1: skipped rows excluded from correlation
}

interface FoodCorrelation {
  food_name:      string;
  crash_count:    number;
  sustain_count:  number;
  total:          number;
  crash_rate:     number;    // crash_count / total
  avg_gl:         number;    // avg GL of this food's logged entries
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET')    return jsonResponse(405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  // ── Fetch both datasets in parallel ───────────────────────────────────────
  const [logsRes, energyRes] = await Promise.all([
    supabaseAdmin
      .from('daily_logs')
      .select('id, food_name, gl, cal, meal, log_date, created_at')
      .eq('user_id', auth.userId)
      .gte('log_date', since)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('energy_logs')
      .select('id, level, log_date, created_at, skipped')
      .eq('user_id', auth.userId)
      .gte('log_date', since)
      .eq('skipped', false)           // Phase 2B.1: exclude skipped check-ins
      .order('created_at', { ascending: true }),
  ]);

  if (logsRes.error || energyRes.error) {
    console.error('[analyze-energy]', logsRes.error?.message, energyRes.error?.message);
    return jsonResponse(500, { error: 'query_failed' });
  }

  const logs    = (logsRes.data ?? []) as LogRow[];
  const energy  = (energyRes.data ?? []) as EnergyRow[];

  if (energy.length < MIN_OBSERVATIONS) {
    return jsonResponse(200, {
      success: true,
      insufficient_data: true,
      energy_logs_count: energy.length,
      needed: MIN_OBSERVATIONS,
      message: `Log your energy at least ${MIN_OBSERVATIONS} times to unlock crash analysis. You have ${energy.length}.`,
    });
  }

  // ── Correlate: for each energy entry, find meals 60–90 min prior ──────────
  const foodStats = new Map<string, {
    crash: number; sustain: number; glSum: number; glCount: number;
  }>();

  let crashMealGLSum = 0,  crashMealCount = 0;
  let steadyMealGLSum = 0, steadyMealCount = 0;

  for (const e of energy) {
    const eTime = new Date(e.created_at).getTime();
    const windowStart = eTime - WINDOW_MAX_MINUTES * 60_000;
    const windowEnd   = eTime - WINDOW_MIN_MINUTES * 60_000;

    // All foods logged inside the prior window on the same IST date
    const priorMeal = logs.filter(l => {
      if (l.log_date !== e.log_date) return false;
      const lTime = new Date(l.created_at).getTime();
      return lTime >= windowStart && lTime <= windowEnd;
    });

    if (!priorMeal.length) continue;

    const mealGL = priorMeal.reduce((s, l) => s + (l.gl ?? 0), 0);
    const isCrash = e.level === 'low';
    const isSustain = e.level === 'steady' || e.level === 'high';

    if (isCrash)   { crashMealGLSum += mealGL;  crashMealCount++; }
    if (isSustain) { steadyMealGLSum += mealGL; steadyMealCount++; }

    for (const l of priorMeal) {
      const key = l.food_name.trim();
      const s = foodStats.get(key) ?? { crash: 0, sustain: 0, glSum: 0, glCount: 0 };
      if (isCrash)   s.crash++;
      if (isSustain) s.sustain++;
      s.glSum   += l.gl ?? 0;
      s.glCount += 1;
      foodStats.set(key, s);
    }
  }

  // ── Aggregate + apply statistical floor ────────────────────────────────────
  const correlations: FoodCorrelation[] = [];
  for (const [food_name, s] of foodStats) {
    const total = s.crash + s.sustain;
    if (total < MIN_OBSERVATIONS) continue;   // ← constraint: ignore n<5
    correlations.push({
      food_name,
      crash_count:   s.crash,
      sustain_count: s.sustain,
      total,
      crash_rate:    Math.round((s.crash / total) * 100) / 100,
      avg_gl:        Math.round((s.glSum / Math.max(s.glCount, 1)) * 10) / 10,
    });
  }

  const crashTriggers = correlations
    .filter(c => c.crash_rate >= ENERGY_CRASH_THRESHOLD)
    .sort((a, b) => b.crash_rate - a.crash_rate || b.total - a.total)
    .slice(0, MAX_RESULTS_PER_SIDE);

  const sustainers = correlations
    .filter(c => c.crash_rate <= ENERGY_SUSTAIN_THRESHOLD)
    .sort((a, b) => a.crash_rate - b.crash_rate || b.total - a.total)
    .slice(0, MAX_RESULTS_PER_SIDE);

  return jsonResponse(200, {
    success: true,
    insufficient_data: false,
    window: { lookback_days: LOOKBACK_DAYS, prior_minutes: [WINDOW_MIN_MINUTES, WINDOW_MAX_MINUTES] },
    observations: {
      energy_logs:      energy.length,
      correlated_crash:  crashMealCount,
      correlated_steady: steadyMealCount,
    },
    gl_insight: {
      avg_crash_meal_gl:  crashMealCount  ? Math.round(crashMealGLSum / crashMealCount)   : null,
      avg_steady_meal_gl: steadyMealCount ? Math.round(steadyMealGLSum / steadyMealCount) : null,
    },
    crash_triggers: crashTriggers,
    sustainers,
  });
};
