/**
 * Personal feature store (2.1 P1). Deterministic, explainable, no invented data.
 * For every feature and window (1/7/14/30/90 days) we keep: value, baseline (the previous window of the same length),
 * delta, trend, sample size, confidence, calculated_at. Missing data stays null: we never fill gaps.
 */
import type { DayRow, MealRow, Targets, Feature, Confidence, Trend, Meal } from './types';
import { addDays, isWeekend } from './dates';

export const WINDOWS = [1, 7, 14, 30, 90] as const;
export const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** How much we trust a number that rests on `n` observations in a window of `windowDays` days. */
export function confidenceFor(n: number, windowDays: number): Confidence {
  if (n <= 0) return 'none';
  if (windowDays === 1) return 'low';              // one day can never be more than a hint
  const share = n / windowDays;
  if (n >= 5 && share >= 0.6) return 'high';
  if (n >= 3 && share >= 0.3) return 'medium';
  return 'low';
}

type Kind = 'amount' | 'scale' | 'pct';
/** The smallest move we call a trend. Smaller moves are "flat". */
function trendOf(kind: Kind, value: number | null, baseline: number | null, nValue: number, nBase: number): Trend {
  if (value == null || baseline == null || nValue < 2 || nBase < 2) return 'unknown';
  const d = value - baseline;
  const limit = kind === 'amount' ? Math.max(Math.abs(baseline) * 0.05, 1) : kind === 'scale' ? 0.3 : 5;
  return Math.abs(d) < limit ? 'flat' : d > 0 ? 'up' : 'down';
}

interface Series { values: number[]; days: number }          // observed values and how many days were looked at
type Pick = (rows: DayRow[], w: { from: string; to: string }, ctx: Ctx) => Series;
interface Ctx { targets: Targets; meals: MealRow[]; flexDays: string[] }

const inWin = (day: string, w: { from: string; to: string }) => day >= w.from && day <= w.to;
const logged = (r: DayRow) => r.items > 0;

const DEFS: Array<{ key: string; kind: Kind; pick: Pick; reduce?: (xs: number[]) => number | null }> = [
  { key: 'calories_avg', kind: 'amount', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && logged(r)).map(r => r.calories), days: 0 }) },
  { key: 'protein_avg', kind: 'amount', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && logged(r)).map(r => r.protein_g), days: 0 }) },
  { key: 'calorie_vs_target_pct', kind: 'pct', pick: (rows, w, c) => ({ values: c.targets.cal > 0 ? rows.filter(r => inWin(r.day, w) && logged(r)).map(r => (r.calories / c.targets.cal) * 100) : [], days: 0 }) },
  { key: 'protein_vs_target_pct', kind: 'pct', pick: (rows, w, c) => ({ values: c.targets.protein > 0 ? rows.filter(r => inWin(r.day, w) && logged(r)).map(r => (r.protein_g / c.targets.protein) * 100) : [], days: 0 }) },
  { key: 'meals_per_day', kind: 'amount', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && logged(r)).map(r => r.meals), days: 0 }) },
  { key: 'energy_avg', kind: 'scale', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && r.energy != null).map(r => r.energy as number), days: 0 }) },
  { key: 'hunger_avg', kind: 'scale', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && r.hunger != null).map(r => r.hunger as number), days: 0 }) },
  { key: 'mood_avg', kind: 'scale', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && r.mood != null).map(r => r.mood as number), days: 0 }) },
  { key: 'fullness_avg', kind: 'scale', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && r.fullness != null).map(r => r.fullness as number), days: 0 }) },
  { key: 'sleep_avg', kind: 'scale', pick: (rows, w) => ({ values: rows.filter(r => inWin(r.day, w) && r.sleep != null).map(r => ({ poor: 1, okay: 2, good: 3 } as const)[r.sleep as 'poor' | 'okay' | 'good']), days: 0 }) },
];

/** Per-meal protein on the days that meal was logged (sums the items of that meal each day). */
function mealProtein(meal: Meal): Pick {
  return (_rows, w, c) => {
    const byDay = new Map<string, number>();
    for (const m of c.meals) if (m.meal === meal && inWin(m.day, w)) byDay.set(m.day, (byDay.get(m.day) ?? 0) + m.protein);
    return { values: [...byDay.values()], days: 0 };
  };
}
const homeShare: Pick = (_rows, w, c) => {
  const ms = c.meals.filter(m => inWin(m.day, w) && m.is_home != null);
  return { values: ms.length ? [(ms.filter(m => m.is_home).length / ms.length) * 100] : [], days: 0 };
};

function computeOne(
  key: string, kind: Kind, pick: Pick, rows: DayRow[], ctx: Ctx, today: string, windowDays: number, now: string,
  reduceFn: (xs: number[]) => number | null = mean,
): Feature {
  const cur = { from: addDays(today, -(windowDays - 1)), to: today };
  const prev = { from: addDays(today, -(2 * windowDays - 1)), to: addDays(today, -windowDays) };
  const a = pick(rows, cur, ctx), b = pick(rows, prev, ctx);
  const value = reduceFn(a.values), baseline = reduceFn(b.values);
  const v = value == null ? null : r1(value), bl = baseline == null ? null : r1(baseline);
  return {
    key, window_days: windowDays, value: v, baseline: bl,
    delta: v != null && bl != null ? r1(v - bl) : null,
    trend: trendOf(kind, v, bl, a.values.length, b.values.length),
    sample_size: a.values.length, confidence: confidenceFor(a.values.length, windowDays), calculated_at: now,
  };
}

export interface FeatureInput { rows: DayRow[]; meals?: MealRow[]; flexDays?: string[]; targets: Targets; today: string; now?: Date }

/** All features for all windows. Pure: same input, same output. */
export function computeFeatures(inp: FeatureInput): Feature[] {
  const now = (inp.now ?? new Date()).toISOString();
  const ctx: Ctx = { targets: inp.targets, meals: inp.meals ?? [], flexDays: inp.flexDays ?? [] };
  const out: Feature[] = [];
  for (const w of WINDOWS) {
    for (const d of DEFS) out.push(computeOne(d.key, d.kind, d.pick, inp.rows, ctx, inp.today, w, now));
    for (const m of MEAL_ORDER) out.push(computeOne(`${m}_protein_avg`, 'amount', mealProtein(m), inp.rows, ctx, inp.today, w, now));
    out.push(computeOne('home_share_pct', 'pct', homeShare, inp.rows, ctx, inp.today, w, now));

    // Logging consistency: share of days in the window with anything logged. Denominator is the window (a missed day counts).
    const cur = { from: addDays(inp.today, -(w - 1)), to: inp.today };
    const prev = { from: addDays(inp.today, -(2 * w - 1)), to: addDays(inp.today, -w) };
    const cnt = (win: { from: string; to: string }) => inp.rows.filter(r => inWin(r.day, win) && logged(r)).length;
    const c1 = cnt(cur), c0 = cnt(prev);
    const v = r1((c1 / w) * 100), bl = r1((c0 / w) * 100);
    out.push({
      key: 'logging_consistency_pct', window_days: w, value: v, baseline: bl, delta: r1(v - bl),
      trend: w === 1 ? 'unknown' : trendOf('pct', v, bl, w, w), sample_size: w, confidence: confidenceFor(c1, w), calculated_at: now,
    });

    // Flexible meals planned in the window.
    const flex = (ctx.flexDays).filter(d => inWin(d, cur)).length;
    out.push({ key: 'flexible_meal_count', window_days: w, value: flex, baseline: (ctx.flexDays).filter(d => inWin(d, prev)).length, delta: null, trend: 'unknown', sample_size: w, confidence: confidenceFor(c1, w), calculated_at: now });

    // Weekday vs weekend behaviour (needs real weekend and weekday days; 30 and 90 day windows only).
    if (w >= 30) {
      const days = inp.rows.filter(r => inWin(r.day, cur) && logged(r));
      const we = days.filter(r => isWeekend(r.day)).map(r => r.calories), wd = days.filter(r => !isWeekend(r.day)).map(r => r.calories);
      const ok = we.length >= 3 && wd.length >= 3;
      out.push({
        key: 'weekend_calorie_gap', window_days: w, value: ok ? r1(mean(we)! - mean(wd)!) : null, baseline: null, delta: null, trend: 'unknown',
        sample_size: Math.min(we.length, wd.length), confidence: ok ? confidenceFor(Math.min(we.length, wd.length), w) : 'none', calculated_at: now,
      });
    }
  }
  return out;
}

/** Index features as map[key][window]. */
export function indexFeatures(fs: Feature[]): Record<string, Record<number, Feature>> {
  const m: Record<string, Record<number, Feature>> = {};
  for (const f of fs) (m[f.key] ??= {})[f.window_days] = f;
  return m;
}
export type FeatureIndex = ReturnType<typeof indexFeatures>;

/** Consecutive logged days ending today (or yesterday if today is empty so far). */
export function loggingStreak(rows: DayRow[], today: string): number {
  const set = new Set(rows.filter(logged).map(r => r.day));
  let d = set.has(today) ? today : addDays(today, -1), n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
