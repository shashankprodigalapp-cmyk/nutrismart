import { describe, it, expect } from 'vitest';
import { planFlexibleMeal, type PlannerInput } from '../../lib/flexibleMeal';

const base: PlannerInput = {
  target: { cal: 2000, protein: 140, carbs: 200, fat: 65 },
  eaten: { cal: 650, protein: 42, carbs: 70, fat: 20 },
  reservationCal: 1000,
};

describe('planFlexibleMeal', () => {
  it('works out remaining and what is left for other food', () => {
    const o = planFlexibleMeal(base);
    expect(o.remaining.calories).toBe(1350); expect(o.remaining.protein).toBe(98); expect(o.leftForOtherFood).toBe(350);
    expect(o.remaining.carbs).toBe(130); expect(o.remaining.fat).toBe(45);
  });
  it('gives pre-meal ranges that fit the calories left', () => {
    const o = planFlexibleMeal(base);
    expect(o.preMeal.calories).toEqual([250, 350]);
    // 60-70% of 98g protein would be 60-70g, but 70g of protein = 280 kcal; capped to 60% of 350 kcal = 52.5g
    expect(o.preMeal.protein[1]).toBeLessThanOrEqual(55);
    expect(o.preMeal.protein[0]).toBeLessThanOrEqual(o.preMeal.protein[1]);
  });
  it('with a smaller meal and more room, protein is 60-70% of what remains', () => {
    const o = planFlexibleMeal({ ...base, reservationCal: 500, eaten: { cal: 300, protein: 20, carbs: 30, fat: 10 } });
    expect(o.leftForOtherFood).toBe(1200); expect(o.preMeal.calories).toEqual([840, 1200]); expect(o.preMeal.protein).toEqual([70, 85]);
  });
  it('a meal that fits the day is comfortable', () => { expect(planFlexibleMeal({ ...base, reservationCal: 600 }).dayStatus).toBe('comfortable'); });
  it('warns and never returns negative ranges when the meal is bigger than what is left', () => {
    const o = planFlexibleMeal({ ...base, eaten: { cal: 1500, protein: 90, carbs: 150, fat: 50 } });
    expect(o.leftForOtherFood).toBe(-500); expect(o.preMeal.calories).toEqual([0, 0]); expect(o.preMeal.protein).toEqual([0, 0]);
    expect(o.warnings.length).toBeGreaterThan(0); expect(o.dayStatus).toBe('over');
  });
  it('a meal that takes the day slightly past target is a stretch', () => {
    expect(planFlexibleMeal({ ...base, eaten: { cal: 1500, protein: 90, carbs: 150, fat: 50 }, reservationCal: 600 }).dayStatus).toBe('stretch');
  });
  it('applies a coach cap and says so', () => {
    const o = planFlexibleMeal({ ...base, coach: { maxReservationCal: 700 } });
    expect(o.reservationUsed).toBe(700); expect(o.warnings[0]).toContain('700');
  });
  it('judges the week too: a heavy day after a light week is fine', () => {
    const light = planFlexibleMeal({ ...base, weekEatenBeforeToday: 3 * 1700, weekDaysBeforeToday: 3 });
    expect(light.week!.target).toBe(14000); expect(light.week!.overBy).toBeLessThanOrEqual(0);
    const heavy = planFlexibleMeal({ ...base, weekEatenBeforeToday: 3 * 2400, weekDaysBeforeToday: 3 });
    expect(heavy.week!.overBy).toBeGreaterThan(0);
  });
  it('has no week section when no history is given', () => { expect(planFlexibleMeal(base).week).toBeNull(); });
  it('suggests diet-appropriate protein sources', () => {
    expect(planFlexibleMeal({ ...base, dietType: 'eggetarian' }).priorities.join(' ')).toContain('Eggs');
    expect(planFlexibleMeal({ ...base, dietType: 'vegan' }).priorities.join(' ')).toContain('Plant');
  });
  it('is deterministic', () => { expect(planFlexibleMeal(base)).toEqual(planFlexibleMeal(base)); });
});
