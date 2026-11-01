import type { MealRow, Meal } from './types';

export interface KnownFood { name: string; uses: number; avgCal: number; avgProtein: number; meals: Meal[] }

/** Foods this person really logs, with how often and their usual numbers per entry. Only foods used `minUses`+ times. */
export function knownFoods(meals: MealRow[], minUses = 2): KnownFood[] {
  const g = new Map<string, { n: number; cal: number; pro: number; meals: Set<Meal> }>();
  for (const m of meals) {
    const k = m.food_name.trim().toLowerCase();
    const e = g.get(k) ?? { n: 0, cal: 0, pro: 0, meals: new Set<Meal>() };
    e.n++; e.cal += m.cal; e.pro += m.protein; e.meals.add(m.meal); g.set(k, e);
  }
  const display = new Map<string, string>();
  for (const m of meals) if (!display.has(m.food_name.trim().toLowerCase())) display.set(m.food_name.trim().toLowerCase(), m.food_name.trim());
  return [...g.entries()].filter(([, e]) => e.n >= minUses).map(([k, e]) => ({
    name: display.get(k)!, uses: e.n, avgCal: Math.round(e.cal / e.n), avgProtein: Math.round((e.pro / e.n) * 10) / 10, meals: [...e.meals],
  }));
}

/** lunch -> lunches, dinner -> dinners ... */
export const plural = (m: string) => (m.endsWith('ch') || m.endsWith('s') ? m + 'es' : m + 's');
