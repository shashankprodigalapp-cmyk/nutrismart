/**
 * Energy, hunger and mood observations (2.1 P6).
 * Rules: a minimum number of observations, always show the sample, observational words only, no diagnosis, no causes.
 */
import type { DayRow, MealRow, Targets } from './types';

export const MIN_DAYS = 6;       // days that have both a check-in answer and food logged
export const MIN_HITS = 3;       // times the pattern must show up before we mention it
const FORBIDDEN = /\b(cause[sd]?|causing|because of|due to|leads? to|diagnos\w*|disease|deficien\w*|disorder|syndrome|treat\w*|cure)\b/i;
export const isObservational = (t: string) => !FORBIDDEN.test(t);
const CAVEAT = ' This is an observation from your own logs, not a reason.';

export interface Observation { key: string; text: string; sample_size: number; hits: number }

export function observe(inp: { rows: DayRow[]; meals?: MealRow[]; targets: Targets; digestion?: Array<{ day: string; digestion: 'comfortable' | 'heavy' | 'upset' | null }> }): Observation[] {
  const out: Observation[] = [];
  const logged = inp.rows.filter(r => r.items > 0);

  // Lower energy on days protein was well under the goal
  const withE = logged.filter(r => r.energy != null);
  if (withE.length >= MIN_DAYS && inp.targets.protein > 0) {
    const lowP = withE.filter(r => r.protein_g < inp.targets.protein * 0.7);
    const hits = lowP.filter(r => (r.energy as number) <= 2).length;
    if (lowP.length >= MIN_HITS && hits >= MIN_HITS) out.push({
      key: 'energy_low_protein', hits, sample_size: lowP.length,
      text: `On ${hits} of your ${lowP.length} days with protein under 70% of your goal, you reported lower energy (1 or 2 out of 5).${CAVEAT}`,
    });
  }

  // High hunger after a low-protein lunch
  if (inp.meals && inp.targets.protein > 0) {
    const lunchP = new Map<string, number>();
    for (const m of inp.meals) if (m.meal === 'lunch') lunchP.set(m.day, (lunchP.get(m.day) ?? 0) + m.protein);
    const days = logged.filter(r => r.hunger != null && lunchP.has(r.day));
    const low = days.filter(r => (lunchP.get(r.day) as number) < inp.targets.protein * 0.35 * 0.6);
    const hits = low.filter(r => (r.hunger as number) >= 4).length;
    if (days.length >= MIN_DAYS && low.length >= MIN_HITS && hits >= MIN_HITS) out.push({
      key: 'hunger_low_protein_lunch', hits, sample_size: low.length,
      text: `On ${hits} of your ${low.length} days with a light-protein lunch, you reported high hunger (4 or 5 out of 5).${CAVEAT}`,
    });
  }

  // Feeling heavy after eating
  const dg = (inp.digestion ?? []).filter(d => d.digestion != null);
  if (dg.length >= MIN_DAYS) {
    const heavy = dg.filter(d => d.digestion !== 'comfortable').length;
    if (heavy >= MIN_HITS) out.push({
      key: 'digestion_heavy', hits: heavy, sample_size: dg.length,
      text: `On ${heavy} of your last ${dg.length} check-ins you noted feeling heavy or unsettled after eating. If this keeps happening, it is worth mentioning to a doctor or dietitian.`,
    });
  }

  // Poor sleep and next-day hunger (only the pairing, never a claim)
  const pairs = logged.filter(r => r.sleep != null && r.hunger != null);
  if (pairs.length >= MIN_DAYS) {
    const poor = pairs.filter(r => r.sleep === 'poor');
    const hits = poor.filter(r => (r.hunger as number) >= 4).length;
    if (poor.length >= MIN_HITS && hits >= MIN_HITS) out.push({
      key: 'hunger_after_poor_sleep', hits, sample_size: poor.length,
      text: `On ${hits} of your ${poor.length} days marked as poor sleep, you also reported high hunger.${CAVEAT}`,
    });
  }
  return out.filter(o => isObservational(o.text));
}
