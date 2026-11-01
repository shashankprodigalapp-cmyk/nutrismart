import { describe, it, expect } from 'vitest';
import { computeFeatures, indexFeatures } from '../../lib/intel/features';
import { recommend } from '../../lib/intel/recommend';
import { suggestSmartMeal, nextMealFor } from '../../lib/intel/smartMeal';
import { knownFoods } from '../../lib/intel/foodHistory';
import { days, meal, TODAY, TARGETS } from './fixtures';
import { addDays, weekStart } from '../../lib/intel/dates';
import type { MealRow } from '../../lib/intel/types';

const NOW = new Date('2026-11-01T10:00:00Z');
// Lunches are low in protein (roti + sabzi, 6g) for 10 days; the person also logs dal and curd now and then.
const lunchHistory = (): MealRow[] => {
  const m: MealRow[] = [];
  for (let i = 0; i < 10; i++) { const d = addDays(TODAY, -i); m.push(meal(d, 'lunch', 'Roti sabzi', 420, 6)); if (i % 2 === 0) m.push(meal(d, 'dinner', 'Dal', 180, 12)); if (i % 3 === 0) m.push(meal(d, 'snack', 'Curd', 100, 9)); }
  return m;
};
const feats = (rows = days(14, () => ({})), meals = lunchHistory()) => indexFeatures(computeFeatures({ rows, meals, targets: TARGETS, today: TODAY, now: NOW }));
const rec = (over: Partial<Parameters<typeof recommend>[0]> = {}) => recommend({ features: feats(), rows: days(14, () => ({})), meals: lunchHistory(), targets: TARGETS, today: TODAY, ...over });

describe('2.1 recommendations', () => {
  it('protein-low lunches produce a personal recommendation that uses foods the person already logs', () => {
    const r = rec().find(x => x.rec_key === 'protein_lunch')!;
    expect(r).toBeTruthy();
    expect(r.rec_type).toBe('protein_addition');
    expect(r.action).toMatch(/Dal/); expect(r.action).toMatch(/Curd/);
    expect(r.evidence[0]).toMatch(/averaged 6g protein/);
  });
  it('every recommendation has reason, evidence, confidence, action, expected outcome and follow-up', () => {
    for (const r of rec()) {
      expect(r.reason.length).toBeGreaterThan(5); expect(r.evidence.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(r.confidence);
      expect(r.action.length).toBeGreaterThan(5); expect(r.expected_outcome.length).toBeGreaterThan(5);
      expect(r.follow_up_at > TODAY).toBe(true);
    }
  });
  it('falls back to a generic line only when there is no food history to use', () => {
    const noFoods = [] as MealRow[]; for (let i = 0; i < 10; i++) noFoods.push(meal(addDays(TODAY, -i), 'lunch', `Item ${i}`, 400, 5));
    const r = recommend({ features: feats(days(14, () => ({})), noFoods), rows: days(14, () => ({})), meals: noFoods, targets: TARGETS, today: TODAY }).find(x => x.rec_key === 'protein_lunch')!;
    expect(r.rec_type).toBe('meal_adjustment'); expect(r.confidence).toBe('low');
  });
  it('says nothing when protein is fine', () => {
    const ok: MealRow[] = []; for (let i = 0; i < 10; i++) ok.push(meal(addDays(TODAY, -i), 'lunch', 'Rajma chawal', 500, 28));
    expect(recommend({ features: feats(days(14, () => ({})), ok), rows: days(14, () => ({})), meals: ok, targets: TARGETS, today: TODAY }).filter(x => x.rec_key.startsWith('protein_'))).toHaveLength(0);
  });
  it('needs at least 3 days of that meal before it says anything', () => {
    const few = [meal(TODAY, 'lunch', 'Roti', 400, 4), meal(addDays(TODAY, -1), 'lunch', 'Roti', 400, 4)];
    expect(recommend({ features: feats(days(14, () => ({})), few), rows: days(14, () => ({})), meals: few, targets: TARGETS, today: TODAY }).filter(x => x.rec_key === 'protein_lunch')).toHaveLength(0);
  });
  it('calories well over goal suggests a smaller portion of the biggest repeated item', () => {
    const rows = days(14, () => ({ calories: 2500 }));
    const meals: MealRow[] = []; for (let i = 0; i < 7; i++) meals.push(meal(addDays(TODAY, -i), 'dinner', 'Biryani', 900, 25));
    const r = recommend({ features: feats(rows, meals), rows, meals, targets: TARGETS, today: TODAY }).find(x => x.rec_key === 'calories_over')!;
    expect(r.rec_type).toBe('portion_adjustment'); expect(r.action).toMatch(/Biryani/); expect(r.expected_outcome).toMatch(/kcal less per day/);
  });
  it('very low logged calories asks to check missing entries, with no medical claim', () => {
    const rows = days(14, () => ({ calories: 900 }));
    const r = recommend({ features: feats(rows, []), rows, meals: [], targets: TARGETS, today: TODAY }).find(x => x.rec_key === 'calories_under')!;
    expect(r.rec_type).toBe('check_in'); expect(r.action).toMatch(/not logged/); expect(r.action + r.reason).not.toMatch(/diagnos|disease|starv/i);
  });
  it('logging gaps give a small, kind ask', () => {
    const rows = days(14, i => (i % 3 === 0 ? {} : null));
    const r = recommend({ features: feats(rows, []), rows, meals: [], targets: TARGETS, today: TODAY }).find(x => x.rec_key === 'logging_gap')!;
    expect(r.action).toMatch(/one meal/); expect(r.evidence[0]).toMatch(/of the last 7 days/);
  });
  it('a long streak earns a positive note', () => {
    expect(rec({ max: 10 }).some(x => x.rec_key === 'streak')).toBe(true);
  });
  it('a far-off fortnight points to a coach or dietitian', () => {
    const rows = days(14, () => ({ calories: 1000, protein_g: 30 }));
    expect(recommend({ features: feats(rows, []), rows, meals: [], targets: TARGETS, today: TODAY, max: 10 }).some(x => x.rec_type === 'coach_review')).toBe(true);
  });
  it('a reserved flexible meal produces a plan for the rest of the day', () => {
    const r = rec({ flexReservedCal: 1000, today_totals: { calories: 400, protein: 20, meals: ['breakfast'] }, hour: 12, max: 10 }).find(x => x.rec_type === 'flexible_meal')!;
    expect(r.reason).toMatch(/1000 kcal/); expect(r.evidence[0]).toMatch(/left for the rest of today/);
  });
  it('does not repeat a recommendation already made this week or dismissed in the last 7 days', () => {
    const wk = weekStart(TODAY);
    expect(rec({ recent: [{ rec_key: 'protein_lunch', status: 'new', day: wk }] }).some(x => x.rec_key === 'protein_lunch')).toBe(false);
    expect(rec({ recent: [{ rec_key: 'protein_lunch', status: 'dismissed', day: addDays(TODAY, -3) }] }).some(x => x.rec_key === 'protein_lunch')).toBe(false);
    expect(rec({ recent: [{ rec_key: 'protein_lunch', status: 'dismissed', day: addDays(TODAY, -20) }] }).some(x => x.rec_key === 'protein_lunch')).toBe(true);
  });
  it('returns at most three, best first', () => {
    const r = rec(); expect(r.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
  });
});

describe('2.1 smart meal and food history', () => {
  const hist = lunchHistory();
  it('knownFoods keeps only foods used at least twice and averages their numbers', () => {
    const k = knownFoods([...hist, meal(TODAY, 'snack', 'One-off', 100, 1)]);
    expect(k.find(f => f.name === 'One-off')).toBeUndefined();
    expect(k.find(f => f.name === 'Dal')!.avgProtein).toBe(12);
  });
  it('suggests only foods the person already logs and fits the remaining calories', () => {
    const s = suggestSmartMeal({ targets: TARGETS, eaten: { calories: 1400, protein: 60, meals: ['breakfast', 'lunch'] }, history: hist }, 17)!;
    expect(s.items.length).toBeGreaterThan(0);
    for (const i of s.items) expect(['Dal', 'Curd', 'Roti sabzi']).toContain(i.name);
    expect(s.total.cal).toBeLessThanOrEqual(Math.round((TARGETS.cal - 1400) * 1.1) + 1);
  });
  it('respects a reserved flexible meal and never plans below the floor', () => {
    const s = suggestSmartMeal({ targets: TARGETS, eaten: { calories: 500, protein: 20, meals: ['breakfast'] }, flexReservedCal: 1000, history: hist }, 13)!;
    expect(s.remaining.cal).toBe(500); expect(s.why).toMatch(/1000 kcal for a flexible meal/);
    const tight = suggestSmartMeal({ targets: TARGETS, eaten: { calories: 1900, protein: 90, meals: ['breakfast', 'lunch', 'snack'] }, history: hist }, 19)!;
    expect(tight.note).toMatch(/light option/);
  });
  it('has nothing to say without history', () => { expect(suggestSmartMeal({ targets: TARGETS, eaten: { calories: 0, protein: 0, meals: [] }, history: [] })).toBeNull(); });
  it('picks the sensible next meal for the hour', () => {
    expect(nextMealFor([], 8)).toBe('breakfast'); expect(nextMealFor(['breakfast'], 13)).toBe('lunch'); expect(nextMealFor(['breakfast', 'lunch'], 13)).toBe('snack');
  });
});
