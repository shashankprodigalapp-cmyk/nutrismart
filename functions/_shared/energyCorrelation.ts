export const ENERGY_LOOKBACK_DAYS    = 60;
export const ENERGY_WINDOW_MIN_MIN   = 60;
export const ENERGY_WINDOW_MAX_MIN   = 90;
export const ENERGY_MIN_OBSERVATIONS = 5;
export const ENERGY_CRASH_THRESHOLD  = 0.60;
export const ENERGY_SUSTAIN_THRESHOLD = 0.40;

export type EnergySignal =
  | 'insufficient_data'
  | 'neutral'
  | 'steady_association'
  | 'low_energy_association';

export interface FoodEnergyCorrelation {
  food_name:     string;
  crash_count:   number;
  sustain_count: number;
  total:         number;
  crash_rate:    number;
  signal:        EnergySignal;
}

export interface EnergyCorrelationResult {
  correlations:   FoodEnergyCorrelation[];
  crashTriggers:  FoodEnergyCorrelation[];
  sustainers:     FoodEnergyCorrelation[];
  glInsight: {
    avgCrashMealGL:  number | null;
    avgSteadyMealGL: number | null;
  };
  hasEnoughData:  boolean;
  energyLogCount: number;
}

interface EnergyObs {
  level:      'low' | 'steady' | 'high';
  log_date:   string;
  created_at: string;
  skipped?:   boolean;
}

interface FoodObs {
  food_name:  string;
  gl:         number;
  log_date:   string;
  created_at: string;
}

export function correlateEnergyToFoods(
  foodLogs:   FoodObs[],
  energyLogs: EnergyObs[],
): EnergyCorrelationResult {
  const nonSkipped = energyLogs.filter(e => !e.skipped);

  if (nonSkipped.length < ENERGY_MIN_OBSERVATIONS) {
    return {
      correlations:  [],
      crashTriggers: [],
      sustainers:    [],
      glInsight:     { avgCrashMealGL: null, avgSteadyMealGL: null },
      hasEnoughData:  false,
      energyLogCount: nonSkipped.length,
    };
  }

  const foodStats = new Map<string, {
    crash: number; sustain: number; glSum: number; glCount: number;
  }>();

  let crashGLSum = 0,  crashCount = 0;
  let steadyGLSum = 0, steadyCount = 0;

  for (const e of nonSkipped) {
    const eTime       = new Date(e.created_at).getTime();
    const windowStart = eTime - ENERGY_WINDOW_MAX_MIN * 60_000;
    const windowEnd   = eTime - ENERGY_WINDOW_MIN_MIN * 60_000;

    const priorMeal = foodLogs.filter(l => {
      if (l.log_date !== e.log_date) return false;
      const lt = new Date(l.created_at).getTime();
      return lt >= windowStart && lt <= windowEnd;
    });

    if (!priorMeal.length) continue;

    const mealGL   = priorMeal.reduce((s, l) => s + (l.gl ?? 0), 0);
    const isCrash  = e.level === 'low';
    const isSustain = e.level === 'steady' || e.level === 'high';

    if (isCrash)   { crashGLSum  += mealGL; crashCount++;  }
    if (isSustain) { steadyGLSum += mealGL; steadyCount++; }

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

  const correlations: FoodEnergyCorrelation[] = [];
  for (const [food_name, s] of foodStats) {
    const total = s.crash + s.sustain;
    if (total < ENERGY_MIN_OBSERVATIONS) continue;

    const crash_rate = s.crash / total;
    const signal: EnergySignal =
      crash_rate >= ENERGY_CRASH_THRESHOLD  ? 'low_energy_association' :
      crash_rate <= ENERGY_SUSTAIN_THRESHOLD ? 'steady_association' :
      'neutral';

    correlations.push({ food_name, crash_count: s.crash, sustain_count: s.sustain, total, crash_rate, signal });
  }

  const crashTriggers = correlations
    .filter(c => c.signal === 'low_energy_association')
    .sort((a, b) => b.crash_rate - a.crash_rate || b.total - a.total)
    .slice(0, 6);

  const sustainers = correlations
    .filter(c => c.signal === 'steady_association')
    .sort((a, b) => a.crash_rate - b.crash_rate || b.total - a.total)
    .slice(0, 6);

  return {
    correlations,
    crashTriggers,
    sustainers,
    glInsight: {
      avgCrashMealGL:  crashCount  ? Math.round(crashGLSum  / crashCount)  : null,
      avgSteadyMealGL: steadyCount ? Math.round(steadyGLSum / steadyCount) : null,
    },
    hasEnoughData:  true,
    energyLogCount: nonSkipped.length,
  };
}

export function getEnergySignalForFood(
  foodName: string,
  correlations: FoodEnergyCorrelation[],
): { signal: EnergySignal; total: number; crash_rate: number } {
  const found = correlations.find(
    c => c.food_name.toLowerCase() === foodName.toLowerCase()
  );
  if (!found) return { signal: 'insufficient_data', total: 0, crash_rate: 0 };
  return { signal: found.signal, total: found.total, crash_rate: found.crash_rate };
}
