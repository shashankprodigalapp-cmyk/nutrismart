/**
 * Predictive insights (P8): five forecasts, all plain arithmetic on the person's own logged data. No AI call, so each costs nothing to run.
 * Rules: never predict weight or any health outcome; say "so far", "has tended to", never "will"; below the minimum data, say so instead of guessing.
 * Pure functions. Days are IST dates 'YYYY-MM-DD'.
 */
import type { DayRow, MealRow, Targets, Confidence } from './types';
import { addDays, weekday, weekStart } from './dates';

export const FORECAST_KEYS = ['week_landing', 'hard_weekdays', 'energy_patterns', 'lapse_risk', 'protein_catchup'] as const;
export type ForecastKey = typeof FORECAST_KEYS[number];
/** One feature switch per forecast. energy_patterns ships switched off. */
export const FORECAST_FLAGS: Record<ForecastKey, string> = {
  week_landing: 'forecast_week_landing', hard_weekdays: 'forecast_hard_weekdays', energy_patterns: 'forecast_energy_patterns',
  lapse_risk: 'forecast_lapse_risk', protein_catchup: 'forecast_protein_catchup',
};
export const FORECAST_VERSION = 1;

export interface Forecast {
  key: ForecastKey; version: number;
  status: 'ready' | 'insufficient';
  confidence: Confidence;
  headline: string;
  /** The numbers behind the headline, shown to the person and kept for audit. */
  evidence: string[];
  data: Record<string, unknown>;
  sample_size: number; min_needed: number;
  calculated_at: string; expires_at: string;
}
export interface ForecastInput {
  rows: DayRow[]; meals?: MealRow[]; targets: Targets; today: string; now?: Date;
  /** local hour 0-23, only used by protein catch-up */
  hour?: number;
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const logged = (r: DayRow) => r.meals > 0 && r.calories > 0;
const iso = (i: ForecastInput) => (i.now ?? new Date()).toISOString();
const DAY = 86_400_000;
const endOfDayIso = (i: ForecastInput) => new Date(new Date(i.today + 'T00:00:00Z').getTime() + DAY - 5.5 * 3_600_000).toISOString();
const tomorrowIso = (i: ForecastInput) => new Date(new Date(i.today + 'T00:00:00Z').getTime() + 2 * DAY - 5.5 * 3_600_000).toISOString();

function insufficient(key: ForecastKey, i: ForecastInput, have: number, need: number, what: string, expires: string): Forecast {
  return { key, version: FORECAST_VERSION, status: 'insufficient', confidence: 'none', headline: `Not enough data yet. ${what}`, evidence: [`${have} of ${need} needed`], data: {}, sample_size: have, min_needed: need, calculated_at: iso(i), expires_at: expires };
}

/** 1. Where the week's calories are heading, from the days already finished this week. Today (still in progress) is left out. */
export function weekLanding(i: ForecastInput): Forecast {
  const ws = weekStart(i.today);
  const done = i.rows.filter(r => r.day >= ws && r.day < i.today && logged(r));
  const need = 3;
  if (done.length < need) return insufficient('week_landing', i, done.length, need, 'Log at least 3 finished days this week to see where the week is heading.', endOfDayIso(i));
  const daysLeft = 7 - done.length;                              // every day not yet counted is assumed to look like the average of the counted ones
  const avg = mean(done.map(r => r.calories));
  const so_far = done.reduce((a, r) => a + r.calories, 0);
  const projected = so_far + avg * daysLeft;
  const weeklyTarget = i.targets.cal * 7;
  const pct = (projected / weeklyTarget - 1) * 100;
  const proteinAvg = mean(done.map(r => r.protein_g));
  const band = Math.abs(pct) <= 5 ? 'close to' : pct > 0 ? 'above' : 'below';
  const confidence: Confidence = done.length >= 6 ? 'high' : done.length >= 4 ? 'medium' : 'low';
  return {
    key: 'week_landing', version: FORECAST_VERSION, status: 'ready', confidence,
    headline: `If the rest of the week looks like the days so far, you would finish ${band} your weekly calorie target.`,
    evidence: [`${done.length} finished days logged this week, averaging ${r0(avg)} kcal (target ${i.targets.cal})`, `Week would total about ${r0(projected)} kcal against ${r0(weeklyTarget)}`, `Protein averaging ${r0(proteinAvg)}g (target ${i.targets.protein}g)`],
    data: { week_start: ws, days_counted: done.length, avg_cal: r0(avg), projected_cal: r0(projected), weekly_target_cal: r0(weeklyTarget), diff_pct: r1(pct), avg_protein: r0(proteinAvg) },
    sample_size: done.length, min_needed: need, calculated_at: iso(i), expires_at: endOfDayIso(i),
  };
}

/** 2. Which weekdays have tended to be harder: calories well over target, or protein well short. Last 8 weeks. */
export function hardWeekdays(i: ForecastInput): Forecast {
  const from = addDays(i.today, -56);
  const rows = i.rows.filter(r => r.day >= from && r.day < i.today && logged(r));
  const need = 21;
  if (rows.length < need) return insufficient('hard_weekdays', i, rows.length, need, 'Needs about 3 weeks of logging to see which weekdays are harder.', tomorrowIso(i));
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const per = names.map((name, w) => {
    const d = rows.filter(r => weekday(r.day) === w);
    return { name, w, n: d.length, cal: mean(d.map(r => r.calories)), protein: mean(d.map(r => r.protein_g)) };
  }).filter(p => p.n >= 3);
  const scored = per.map(p => {
    const over = p.cal / i.targets.cal - 1;                       // +0.2 = 20% over
    const short = 1 - p.protein / i.targets.protein;              // +0.2 = 20% short
    const why: string[] = [];
    if (over >= 0.10) why.push(`calories ${r0(over * 100)}% over target`);
    if (short >= 0.15) why.push(`protein ${r0(short * 100)}% short`);
    return { ...p, score: Math.max(over, 0) + Math.max(short, 0), why };
  }).filter(p => p.why.length).sort((a, b) => b.score - a.score).slice(0, 2);
  const confidence: Confidence = rows.length >= 49 ? 'high' : rows.length >= 35 ? 'medium' : 'low';
  if (!scored.length) {
    return { key: 'hard_weekdays', version: FORECAST_VERSION, status: 'ready', confidence, headline: 'No weekday has stood out as harder than the others lately.', evidence: [`Based on ${rows.length} logged days over 8 weeks`], data: { days: [] }, sample_size: rows.length, min_needed: need, calculated_at: iso(i), expires_at: tomorrowIso(i) };
  }
  return {
    key: 'hard_weekdays', version: FORECAST_VERSION, status: 'ready', confidence,
    headline: `${scored.map(s => s.name + 's').join(' and ')} have tended to be your harder days.`,
    evidence: scored.map(s => `${s.name}s: ${s.why.join(', ')} (${s.n} days, avg ${r0(s.cal)} kcal, ${r0(s.protein)}g protein)`),
    data: { days: scored.map(s => ({ weekday: s.w, name: s.name, n: s.n, avg_cal: r0(s.cal), avg_protein: r0(s.protein), reasons: s.why })) },
    sample_size: rows.length, min_needed: need, calculated_at: iso(i), expires_at: tomorrowIso(i),
  };
}

/** 3. Energy and hunger on days protein was hit vs missed. Observation only; it does not say protein causes the difference. Ships switched off. */
export function energyPatterns(i: ForecastInput): Forecast {
  const from = addDays(i.today, -60);
  const rows = i.rows.filter(r => r.day >= from && r.day < i.today && logged(r) && (r.energy != null || r.hunger != null));
  const need = 10;
  if (rows.length < need) return insufficient('energy_patterns', i, rows.length, need, 'Needs about 10 days with both food and an energy or hunger check-in.', tomorrowIso(i));
  const hit = rows.filter(r => r.protein_g >= i.targets.protein * 0.9);
  const miss = rows.filter(r => r.protein_g < i.targets.protein * 0.9);
  if (hit.length < 4 || miss.length < 4) return insufficient('energy_patterns', i, Math.min(hit.length, miss.length), 4, 'Needs at least 4 days where protein was reached and 4 where it was not.', tomorrowIso(i));
  const avgOf = (xs: DayRow[], f: 'energy' | 'hunger') => { const v = xs.map(r => r[f]).filter((n): n is number => typeof n === 'number'); return v.length >= 3 ? { v: mean(v), n: v.length } : null; };
  const lines: string[] = []; const data: Record<string, unknown> = {};
  for (const f of ['energy', 'hunger'] as const) {
    const a = avgOf(hit, f), b = avgOf(miss, f);
    if (!a || !b || Math.abs(a.v - b.v) < 0.5) continue;
    lines.push(`${f === 'energy' ? 'Energy' : 'Hunger'} averaged ${r1(a.v)} on days protein was reached vs ${r1(b.v)} on days it was not`);
    data[f] = { protein_hit: r1(a.v), protein_missed: r1(b.v), n_hit: a.n, n_missed: b.n };
  }
  const confidence: Confidence = rows.length >= 30 ? 'high' : rows.length >= 18 ? 'medium' : 'low';
  if (!lines.length) return { key: 'energy_patterns', version: FORECAST_VERSION, status: 'ready', confidence, headline: 'No clear difference in energy or hunger between high-protein and lower-protein days so far.', evidence: [`${hit.length} days protein reached, ${miss.length} not`], data: { hit_days: hit.length, missed_days: miss.length }, sample_size: rows.length, min_needed: need, calculated_at: iso(i), expires_at: tomorrowIso(i) };
  return { key: 'energy_patterns', version: FORECAST_VERSION, status: 'ready', confidence, headline: 'Your energy and hunger have looked different on high-protein days. This is a pattern, not a cause.', evidence: [...lines, `${hit.length} days protein reached, ${miss.length} not`], data: { ...data, hit_days: hit.length, missed_days: miss.length }, sample_size: rows.length, min_needed: need, calculated_at: iso(i), expires_at: tomorrowIso(i) };
}

/** 4. Risk that logging lapses in the next few days, from how logging has been going. Never shown to the person as a score; used for a gentle check-in and the coach brief. */
export function lapseRisk(i: ForecastInput): Forecast {
  const from = addDays(i.today, -28);
  const rows = i.rows.filter(r => r.day >= from && r.day < i.today && logged(r));
  const need = 7;
  if (rows.length < need) return insufficient('lapse_risk', i, rows.length, need, 'Needs about a week of logging first.', endOfDayIso(i));
  const has = new Set(rows.map(r => r.day));
  const rate = (a: number, b: number) => { let n = 0, t = 0; for (let k = a; k <= b; k++) { t++; if (has.has(addDays(i.today, -k))) n++; } return n / t; };
  const last7 = rate(1, 7), prior = rate(8, 28);
  let gap = 0; while (gap < 28 && !has.has(addDays(i.today, -(gap + 1)))) gap++;   // days in a row missed up to yesterday
  let score = 0; const why: string[] = [];
  if (prior >= 0.5 && last7 < prior * 0.6) { score += 2; why.push(`Logged ${r0(last7 * 7)} of the last 7 days, down from about ${r0(prior * 7)} a week before`); }
  if (gap >= 2) { score += 2; why.push(`${gap} days in a row without a log`); } else if (gap === 1) { score += 1; why.push('Yesterday was not logged'); }
  const dow = weekday(i.today);
  const missOnDow = [7, 14, 21, 28].filter(k => !has.has(addDays(i.today, -k)) && k <= 28).length;
  if (missOnDow >= 3) { score += 1; why.push(`Past ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][dow]} were often not logged`); }
  const level = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  const confidence: Confidence = rows.length >= 18 ? 'high' : rows.length >= 11 ? 'medium' : 'low';
  const headline = level === 'low' ? 'Logging has been steady lately.' : level === 'medium' ? 'Logging has slipped a little lately.' : 'Logging has dropped off noticeably lately.';
  return {
    key: 'lapse_risk', version: FORECAST_VERSION, status: 'ready', confidence, headline,
    evidence: why.length ? why : [`Logged ${r0(last7 * 7)} of the last 7 days`],
    data: { level, score, last7_rate: r1(last7), prior_rate: r1(prior), gap_days: gap },
    sample_size: rows.length, min_needed: need, calculated_at: iso(i), expires_at: endOfDayIso(i),
  };
}

/** 5. How much protein is left today and which of your own usual foods would cover it. Cheap enough to run on every open. */
export function proteinCatchup(i: ForecastInput): Forecast {
  const today = i.rows.find(r => r.day === i.today);
  const have = today?.protein_g ?? 0;
  const left = Math.max(0, i.targets.protein - have);
  const hour = i.hour ?? 12;
  const mealsToday = new Set((i.meals ?? []).filter(m => m.day === i.today).map(m => m.meal));
  const mealsLeft = Math.max(1, (['lunch', 'snack', 'dinner'] as const).filter(m => !mealsToday.has(m)).length);
  const base = { version: FORECAST_VERSION as number, calculated_at: iso(i), expires_at: endOfDayIso(i), min_needed: 0 };
  if (left <= 0) return { key: 'protein_catchup', ...base, status: 'ready', confidence: 'high', headline: 'Protein target reached for today.', evidence: [`${r0(have)}g of ${i.targets.protein}g`], data: { left: 0 }, sample_size: 1 };
  if (hour < 12) return { key: 'protein_catchup', ...base, status: 'insufficient', confidence: 'none', headline: 'Protein catch-up shows from midday.', evidence: [`${r0(have)}g of ${i.targets.protein}g so far`], data: { left: r0(left) }, sample_size: 0 };
  // the person's own protein-dense foods: most often logged, at least 15g protein, at most 18 kcal per gram of protein
  const from = addDays(i.today, -60);
  const tally = new Map<string, { n: number; cal: number; protein: number }>();
  for (const m of i.meals ?? []) {
    if (m.day < from || m.day >= i.today || m.protein < 15 || m.cal / m.protein > 18) continue;
    const k = m.food_name.trim().toLowerCase(); const t = tally.get(k) ?? { n: 0, cal: 0, protein: 0 };
    t.n++; t.cal += m.cal; t.protein += m.protein; tally.set(k, t);
  }
  const foods = [...tally.entries()].filter(([, t]) => t.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([name, t]) => ({ name, cal: r0(t.cal / t.n), protein: r0(t.protein / t.n), times: t.n }));
  const perMeal = r0(left / mealsLeft);
  return {
    key: 'protein_catchup', ...base, status: 'ready', confidence: foods.length ? 'medium' : 'low',
    headline: `${r0(left)}g of protein left today. About ${perMeal}g in each of your ${mealsLeft} remaining meal${mealsLeft > 1 ? 's' : ''} would get you there.`,
    evidence: [`${r0(have)}g of ${i.targets.protein}g so far`, ...(foods.length ? [`Foods you eat often: ${foods.map(f => `${f.name} (${f.protein}g)`).join(', ')}`] : ['Log a few more high-protein foods and we will suggest your own usual ones'])],
    data: { left: r0(left), per_meal: perMeal, meals_left: mealsLeft, foods }, sample_size: foods.length,
  };
}

const BUILDERS: Record<ForecastKey, (i: ForecastInput) => Forecast> = { week_landing: weekLanding, hard_weekdays: hardWeekdays, energy_patterns: energyPatterns, lapse_risk: lapseRisk, protein_catchup: proteinCatchup };

/** Runs only the forecasts whose switch is on, and only on what the person has allowed us to read. */
export function runForecasts(i: ForecastInput, on: Partial<Record<ForecastKey, boolean>>, scope: { food: boolean; energy: boolean } = { food: true, energy: true }): Forecast[] {
  const out: Forecast[] = [];
  for (const k of FORECAST_KEYS) {
    if (!on[k] || !scope.food) continue;
    if (k === 'energy_patterns' && !scope.energy) continue;
    try { out.push(BUILDERS[k](i)); } catch { /* one bad forecast must never break the screen */ }
  }
  return out;
}

/** Stable fingerprint of what a forecast says, ignoring timestamps, so the database is written only when the answer changes. */
export function forecastHash(f: Forecast): string {
  const s = JSON.stringify([f.status, f.confidence, f.headline, f.evidence, f.data, f.version]);
  let h = 5381; for (let k = 0; k < s.length; k++) h = ((h << 5) + h + s.charCodeAt(k)) | 0;
  return (h >>> 0).toString(36);
}
