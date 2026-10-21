import type { Env } from '../_shared/auth';
import {
  verifyJWT,
  getSupabaseAdmin,
  preflightResponse,
  jsonResponse,
} from '../_shared/auth';
import {
  ENERGY_LOOKBACK_DAYS      as LOOKBACK_DAYS,
  ENERGY_WINDOW_MIN_MIN     as WINDOW_MIN_MINUTES,
  ENERGY_WINDOW_MAX_MIN     as WINDOW_MAX_MINUTES,
  ENERGY_MIN_OBSERVATIONS   as MIN_OBSERVATIONS,
  ENERGY_CRASH_THRESHOLD,
  ENERGY_SUSTAIN_THRESHOLD,
} from '../_shared/energyCorrelation';

const MAX_RESULTS_PER_SIDE = 6;

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
  skipped:    boolean;
}

interface FoodCorrelation {
  food_name:      string;
  crash_count:    number;
  sustain_count:  number;
  total:          number;
  crash_rate:     number;
  avg_gl:         number;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET')    return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  const supabaseAdmin = getSupabaseAdmin(env);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

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
      .eq('skipped', false)
      .order('created_at', { ascending: true }),
  ]);

  if (logsRes.error || energyRes.error) {
    console.error('[analyze-energy]', logsRes.error?.message, energyRes.error?.message);
    return jsonResponse(env, 500, { error: 'query_failed' });
  }

  const logs    = (logsRes.data ?? []) as LogRow[];
  const energy  = (energyRes.data ?? []) as EnergyRow[];

  if (energy.length < MIN_OBSERVATIONS) {
    return jsonResponse(env, 200, {
      success: true,
      insufficient_data: true,
      energy_logs_count: energy.length,
      needed: MIN_OBSERVATIONS,
      message: `Log your energy at least ${MIN_OBSERVATIONS} times to unlock crash analysis. You have ${energy.length}.`,
    });
  }

  const foodStats = new Map<string, {
    crash: number; sustain: number; glSum: number; glCount: number;
  }>();

  let crashMealGLSum = 0,  crashMealCount = 0;
  let steadyMealGLSum = 0, steadyMealCount = 0;

  for (const e of energy) {
    const eTime = new Date(e.created_at).getTime();
    const windowStart = eTime - WINDOW_MAX_MINUTES * 60_000;
    const windowEnd   = eTime - WINDOW_MIN_MINUTES * 60_000;

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

  const correlations: FoodCorrelation[] = [];
  for (const [food_name, s] of foodStats) {
    const total = s.crash + s.sustain;
    if (total < MIN_OBSERVATIONS) continue;
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

  return jsonResponse(env, 200, {
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
