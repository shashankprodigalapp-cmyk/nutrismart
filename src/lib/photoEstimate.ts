/**
 * Photo logging helpers (deterministic). A photo gives an ESTIMATE, never an exact measurement, so numbers are shown as
 * a range that widens as confidence drops, and a dish that matches our own food list is preferred over a model's guess.
 */
export type Confidence = 'high' | 'medium' | 'low';

export const SPREAD: Record<Confidence, number> = { high: 0.15, medium: 0.25, low: 0.4 };
export const DB_MATCH_MAX_SCORE = 0.25;     // Fuse score: 0 = exact. Above this we do not trust the match.
export const DISAGREE_RATIO = 0.4;          // AI and food list differ by more than 40%: tell the person

const step = (n: number) => (n >= 500 ? 10 : 5);
const roundTo = (n: number, s: number) => Math.round(n / s) * s;

export function calorieRange(cal: number, conf: Confidence): { low: number; high: number; mid: number } {
  const c = Math.max(0, cal);
  const s = step(c);
  return { low: roundTo(c * (1 - SPREAD[conf]), s), high: roundTo(c * (1 + SPREAD[conf]), s), mid: roundTo(c, s) };
}

export function rangeText(cal: number, conf: Confidence): string {
  const r = calorieRange(cal, conf);
  return `about ${r.mid} kcal (${r.low} to ${r.high})`;
}

export function confidenceNote(conf: Confidence, hasQuestion: boolean): string | null {
  if (conf === 'high' && !hasQuestion) return null;
  if (conf === 'low') return 'Not sure about this one. Check the dish and the portion before adding.';
  if (hasQuestion) return 'Worth a quick check before adding.';
  return 'Portion is a guess. You can change it on the next screen.';
}

export type Source = 'food_list' | 'ai_estimate';
export interface Choice { source: Source; disagree: 'higher' | 'lower' | null }

/** Prefer our own food list when the name matches well. Flag it when the AI number is far from the list's number. */
export function chooseSource(a: { dbScore: number | null; dbCalories: number | null; aiCalories: number | null }): Choice {
  const useDb = a.dbScore != null && a.dbScore <= DB_MATCH_MAX_SCORE && a.dbCalories != null && a.dbCalories > 0;
  let disagree: Choice['disagree'] = null;
  if (useDb && a.aiCalories != null && a.dbCalories) {
    const d = (a.aiCalories - a.dbCalories) / a.dbCalories;
    if (d > DISAGREE_RATIO) disagree = 'higher'; else if (d < -DISAGREE_RATIO) disagree = 'lower';
  }
  return { source: useDb ? 'food_list' : 'ai_estimate', disagree };
}
