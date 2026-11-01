import type { DayRow, MealRow, Meal, Targets } from '../../lib/intel/types';
import { addDays } from '../../lib/intel/dates';

export const TODAY = '2026-11-01';            // a Sunday
export const TARGETS: Targets = { cal: 2000, protein: 100 };

/** Build `n` days ending TODAY. `fn(i, day)` returns a partial row or null for "nothing logged". i = 0 is TODAY. */
export function days(n: number, fn: (i: number, day: string) => Partial<DayRow> | null): DayRow[] {
  const out: DayRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(TODAY, -i), p = fn(i, day);
    if (p) out.push({ day, calories: 1800, protein_g: 80, meals: 3, items: 4, ...p });
  }
  return out;
}
export function meal(day: string, m: Meal, food_name: string, cal: number, protein: number, is_home = true): MealRow {
  return { day, meal: m, food_name, cal, protein, is_home };
}
