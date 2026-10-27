/**
 * FlexibleMealPlanner. Every number comes from this code, never from an AI.
 * A planned high-calorie meal is not a failure: it is judged against the day AND the week.
 *
 * Rules (documented so a coach can explain them to a client):
 *  1. remaining today      = target - eaten so far
 *  2. left for other food  = remaining today - reserved calories for the flexible meal
 *  3. before the meal      = 70% to 100% of "left for other food" (rounded to 10 kcal)
 *  4. protein before meal  = 60% to 70% of the protein still to eat, but never more than 60% of the calories in rule 3
 *  5. day status           = comfortable if the whole day stays within target; stretch if it goes over by up to 15%; over if more
 *  6. week view            = week target (7 x daily) against what was eaten before today + today's plan
 */

export interface Macros { cal: number; protein: number; carbs: number; fat: number; fiber?: number }
export interface PlannerInput {
  target: { cal: number; protein: number; carbs?: number; fat?: number; fiber?: number };
  eaten: Macros;                 // eaten today so far
  reservationCal: number;        // calories set aside for the flexible meal
  mealTime?: string;             // 'HH:mm' (24h), optional
  weekEatenBeforeToday?: number; // calories eaten earlier in this week (Mon..yesterday)
  weekDaysBeforeToday?: number;  // how many days that covers (0-6)
  dietType?: 'eggetarian' | 'vegetarian' | 'vegan' | 'jain' | 'non_veg';
  coach?: { maxReservationCal?: number; minProteinBeforeMeal?: number };
}
export type DayStatus = 'comfortable' | 'stretch' | 'over';
export interface PlannerOutput {
  remaining: { calories: number; protein: number; carbs: number | null; fat: number | null };
  leftForOtherFood: number;
  preMeal: { calories: [number, number]; protein: [number, number] };
  priorities: string[];
  dayProjectedCal: number;
  dayStatus: DayStatus;
  week: { target: number; eatenBeforeToday: number; projected: number; overBy: number; daysCovered: number } | null;
  warnings: string[];
  reservationUsed: number;
}

const round = (n: number, step: number) => Math.round(n / step + 1e-9) * step; // 1e-9 guards 24.4999999 style float noise
const clamp0 = (n: number) => (n < 0 ? 0 : n);

export function planFlexibleMeal(i: PlannerInput): PlannerOutput {
  const warnings: string[] = [];
  let reservation = Math.max(0, Math.round(i.reservationCal));
  const cap = i.coach?.maxReservationCal;
  if (cap != null && reservation > cap) {
    warnings.push(`Your coach limits a flexible meal to ${cap} kcal, so we planned for ${cap}.`);
    reservation = cap;
  }

  const remCal = i.target.cal - i.eaten.cal;
  const remProtein = clamp0(i.target.protein - i.eaten.protein);
  const leftForOther = remCal - reservation;

  if (leftForOther < 0) warnings.push(`This meal is ${Math.round(-leftForOther)} kcal more than what is left today.`);
  if (remCal <= 0) warnings.push('You have already reached today\'s calorie target.');

  const otherBudget = clamp0(leftForOther);
  const calLow = round(otherBudget * 0.7, 10);
  const calHigh = round(otherBudget, 10);

  let protLow = round(remProtein * 0.6, 5);
  let protHigh = round(remProtein * 0.7, 5);
  const protCap = round((calHigh * 0.6) / 4, 5);       // protein calories must fit inside the pre-meal calories
  protLow = Math.min(protLow, protCap); protHigh = Math.min(protHigh, protCap);
  const minP = i.coach?.minProteinBeforeMeal;
  if (minP != null && protHigh < minP && remProtein >= minP) {
    if (protCap >= minP) { protLow = Math.max(protLow, minP); protHigh = Math.max(protHigh, minP); }
    else warnings.push(`Your coach asks for ${minP}g protein before the meal, which does not fit in the calories left.`);
  }

  const priorities: string[] = [];
  if (remProtein > 0) priorities.push('Protein');
  priorities.push('Vegetables and fibre');
  if (i.target.fat != null && i.target.fat - i.eaten.fat < i.target.fat * 0.35) priorities.push('Keep fat moderate');
  else priorities.push('Moderate fat');
  if (i.dietType === 'vegan' || i.dietType === 'jain') priorities.push('Plant protein sources (dal, tofu, soya, sprouts)');
  else if (i.dietType === 'eggetarian') priorities.push('Eggs, dal, paneer or curd for protein');

  const projected = i.eaten.cal + calHigh + reservation;
  const over = projected - i.target.cal;
  const dayStatus: DayStatus = over <= 0 ? 'comfortable' : over <= i.target.cal * 0.15 ? 'stretch' : 'over';

  let week: PlannerOutput['week'] = null;
  if (i.weekEatenBeforeToday != null && i.weekDaysBeforeToday != null) {
    const weekTarget = i.target.cal * 7;
    const weekProjected = i.weekEatenBeforeToday + projected;
    // Days not yet lived are assumed to be on target, so the week figure shows what today changes.
    const daysAfterToday = 6 - i.weekDaysBeforeToday;
    const weekTotal = weekProjected + i.target.cal * Math.max(0, daysAfterToday);
    week = {
      target: weekTarget, eatenBeforeToday: Math.round(i.weekEatenBeforeToday),
      projected: Math.round(weekTotal), overBy: Math.round(weekTotal - weekTarget), daysCovered: i.weekDaysBeforeToday,
    };
  }

  return {
    remaining: {
      calories: Math.round(remCal), protein: Math.round(remProtein),
      carbs: i.target.carbs != null ? Math.round(clamp0(i.target.carbs - i.eaten.carbs)) : null,
      fat: i.target.fat != null ? Math.round(clamp0(i.target.fat - i.eaten.fat)) : null,
    },
    leftForOtherFood: Math.round(leftForOther),
    preMeal: { calories: [calLow, calHigh], protein: [protLow, protHigh] },
    priorities, dayProjectedCal: Math.round(projected), dayStatus, week, warnings, reservationUsed: reservation,
  };
}

export function statusText(s: DayStatus): string {
  return s === 'comfortable' ? 'Fits comfortably in today.' : s === 'stretch' ? 'A small stretch for today.' : 'Well over today. Consider a smaller meal or balance it over the week.';
}
