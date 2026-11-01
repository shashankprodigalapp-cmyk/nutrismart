/**
 * Smart meal (2.1 P3): what fits the rest of the day, built only from foods the person already logs.
 * A reserved flexible meal is respected. We never "punish" with a tiny meal: there is a floor.
 */
import type { MealRow, Meal, Targets } from './types';
import { knownFoods, type KnownFood } from './foodHistory';

export interface SmartMealInput {
  targets: Targets; eaten: { calories: number; protein: number; meals: Meal[] };
  flexReservedCal?: number; nextMeal?: Meal; history: MealRow[];
}
export interface SmartMeal {
  meal: Meal; items: Array<{ name: string; cal: number; protein: number }>; total: { cal: number; protein: number };
  remaining: { cal: number; protein: number }; why: string; note?: string;
}
const ORDER: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const FLOOR_SHARE = 0.12;           // a meal is never planned below 12% of the daily calorie goal

export function nextMealFor(eaten: Meal[], hour: number): Meal {
  const guess: Meal = hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
  if (!eaten.includes(guess)) return guess;
  return ORDER.find(m => !eaten.includes(m) && ORDER.indexOf(m) > ORDER.indexOf(guess)) ?? ORDER.find(m => !eaten.includes(m)) ?? guess;
}

export function suggestSmartMeal(inp: SmartMealInput, hour = 13): SmartMeal | null {
  const meal = inp.nextMeal ?? nextMealFor(inp.eaten.meals, hour);
  const reserved = Math.max(0, inp.flexReservedCal ?? 0);
  const remCal = Math.round(inp.targets.cal - inp.eaten.calories - reserved);
  const remPro = Math.round(Math.max(0, inp.targets.protein - inp.eaten.protein));
  const mealsLeft = Math.max(1, ORDER.filter(m => !inp.eaten.meals.includes(m)).length - (reserved > 0 ? 1 : 0));
  const share = Math.max(remCal / mealsLeft, inp.targets.cal * FLOOR_SHARE);
  const foods = knownFoods(inp.history).filter(f => f.avgCal > 0 && f.avgCal <= share * 1.1);
  if (!foods.length) return null;

  // Best pair (or single) of familiar foods: most protein within the calorie budget, preferring foods eaten at this meal.
  const score = (items: KnownFood[]) => {
    const cal = items.reduce((a, f) => a + f.avgCal, 0), pro = items.reduce((a, f) => a + f.avgProtein, 0);
    if (cal > share * 1.1) return -1;
    const fit = items.filter(f => f.meals.includes(meal)).length * 2;
    const calFill = Math.min(cal / share, 1);
    return Math.min(pro, Math.max(remPro, 1)) + fit + calFill * 3;
  };
  const pool = [...foods].sort((a, b) => b.avgProtein - a.avgProtein || b.uses - a.uses).slice(0, 14);
  let best: KnownFood[] = [], bestS = -1;
  for (let i = 0; i < pool.length; i++) {
    const s1 = score([pool[i]]); if (s1 > bestS) { best = [pool[i]]; bestS = s1; }
    for (let j = i + 1; j < pool.length; j++) { const s2 = score([pool[i], pool[j]]); if (s2 > bestS) { best = [pool[i], pool[j]]; bestS = s2; } }
  }
  if (!best.length) return null;
  const items = best.map(f => ({ name: f.name, cal: f.avgCal, protein: f.avgProtein }));
  const total = { cal: items.reduce((a, i) => a + i.cal, 0), protein: Math.round(items.reduce((a, i) => a + i.protein, 0) * 10) / 10 };
  const why = reserved > 0
    ? `You kept ${reserved} kcal for a flexible meal. After that, about ${Math.max(remCal, 0)} kcal and ${remPro}g protein are left for the rest of today.`
    : `About ${Math.max(remCal, 0)} kcal and ${remPro}g protein are left today. These are foods you already log.`;
  const note = remCal < inp.targets.cal * FLOOR_SHARE ? 'Calories are tight today, so this is a light option, not a fix. Tomorrow is a fresh day.' : undefined;
  return { meal, items, total, remaining: { cal: remCal, protein: remPro }, why, note };
}
