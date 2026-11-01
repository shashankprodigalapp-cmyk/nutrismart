import { describe, it, expect } from 'vitest';
import { computeFeatures, indexFeatures, confidenceFor, loggingStreak, WINDOWS } from '../../lib/intel/features';
import { days, meal, TODAY, TARGETS } from './fixtures';
import { addDays, weekStart, isWeekend } from '../../lib/intel/dates';

const NOW = new Date('2026-11-01T10:00:00Z');
const build = (rows = days(30, () => ({})), meals = [] as ReturnType<typeof meal>[], flexDays: string[] = []) =>
  indexFeatures(computeFeatures({ rows, meals, flexDays, targets: TARGETS, today: TODAY, now: NOW }));

describe('2.1 feature store', () => {
  it('produces every feature for all five windows', () => {
    const f = build();
    for (const key of ['calories_avg', 'protein_avg', 'calorie_vs_target_pct', 'protein_vs_target_pct', 'logging_consistency_pct', 'energy_avg', 'lunch_protein_avg']) {
      for (const w of WINDOWS) expect(f[key]?.[w] !== undefined, `${key} ${w}`).toBe(true);
    }
  });
  it('every feature carries value, baseline, delta, trend, sample size, confidence and calculated_at', () => {
    const all = computeFeatures({ rows: days(30, () => ({})), targets: TARGETS, today: TODAY, now: NOW });
    for (const x of all) {
      expect(x).toHaveProperty('value'); expect(x).toHaveProperty('baseline'); expect(x).toHaveProperty('delta');
      expect(['up', 'down', 'flat', 'unknown']).toContain(x.trend);
      expect(x.sample_size).toBeGreaterThanOrEqual(0);
      expect(['none', 'low', 'medium', 'high']).toContain(x.confidence);
      expect(x.calculated_at).toBe(NOW.toISOString());
    }
  });
  it('averages only logged days and does the arithmetic right', () => {
    const rows = days(7, i => (i === 0 ? null : { calories: 1500 + i * 100, protein_g: 60 + i * 5 }));   // 6 logged days, i = 1..6
    const f = build(rows);
    expect(f.calories_avg[7].value).toBe(1850);                 // mean(1600..2100)
    expect(f.calories_avg[7].sample_size).toBe(6);
    expect(f.protein_avg[7].value).toBe(77.5);
    expect(f.calorie_vs_target_pct[7].value).toBe(92.5);
  });
  it('baseline is the previous window of the same length, delta and trend follow', () => {
    const rows = days(14, i => ({ calories: i < 7 ? 2200 : 1800 }));      // last 7 days higher than the 7 before
    const f = build(rows);
    expect(f.calories_avg[7].value).toBe(2200); expect(f.calories_avg[7].baseline).toBe(1800);
    expect(f.calories_avg[7].delta).toBe(400); expect(f.calories_avg[7].trend).toBe('up');
  });
  it('small moves are flat, not a trend', () => {
    const rows = days(14, i => ({ calories: i < 7 ? 1810 : 1800 }));
    expect(build(rows).calories_avg[7].trend).toBe('flat');
  });
  it('never invents data: no check-ins means null values and confidence none', () => {
    const f = build();
    expect(f.energy_avg[7].value).toBeNull(); expect(f.energy_avg[7].sample_size).toBe(0); expect(f.energy_avg[7].confidence).toBe('none');
    expect(f.energy_avg[7].trend).toBe('unknown');
  });
  it('an empty history gives no numbers at all, only zero-sample rows', () => {
    const f = build([]);
    expect(f.calories_avg[30].value).toBeNull(); expect(f.logging_consistency_pct[30].value).toBe(0);
  });
  it('logging consistency counts missed days against the window', () => {
    const f = build(days(7, i => (i % 2 === 0 ? {} : null)));         // logged on 4 of 7 days
    expect(f.logging_consistency_pct[7].value).toBe(57.1);
  });
  it('confidence grows with sample size and a single day is never more than low', () => {
    expect(confidenceFor(0, 7)).toBe('none'); expect(confidenceFor(2, 7)).toBe('low'); expect(confidenceFor(3, 7)).toBe('medium');
    expect(confidenceFor(6, 7)).toBe('high'); expect(confidenceFor(1, 1)).toBe('low');
  });
  it('scale features (energy) use check-in days only', () => {
    const rows = days(7, i => ({ energy: i < 3 ? 2 : 4 }));
    const f = build(rows);
    expect(f.energy_avg[7].value).toBe(3.1); expect(f.energy_avg[7].sample_size).toBe(7);
  });
  it('per-meal protein sums the items of that meal each day', () => {
    const meals = [meal(TODAY, 'lunch', 'dal', 300, 12), meal(TODAY, 'lunch', 'paneer', 250, 14), meal(addDays(TODAY, -1), 'lunch', 'dal', 300, 12)];
    const f = build(days(7, () => ({})), meals);
    expect(f.lunch_protein_avg[7].value).toBe(19);                       // (26 + 12) / 2 days
    expect(f.lunch_protein_avg[7].sample_size).toBe(2);
  });
  it('home share and flexible meal counts', () => {
    const meals = [meal(TODAY, 'lunch', 'a', 1, 1, true), meal(TODAY, 'dinner', 'b', 1, 1, false)];
    const f = build(days(7, () => ({})), meals, [TODAY, addDays(TODAY, -3), addDays(TODAY, -20)]);
    expect(f.home_share_pct[7].value).toBe(50); expect(f.flexible_meal_count[7].value).toBe(2); expect(f.flexible_meal_count[30].value).toBe(3);
  });
  it('weekend gap needs real weekend and weekday days', () => {
    const none = build(days(30, () => ({})));
    expect(none.weekend_calorie_gap[30].value).toBe(0);
    const rows = days(30, (_i, d) => ({ calories: isWeekend(d) ? 2400 : 1800 }));
    expect(build(rows).weekend_calorie_gap[30].value).toBe(600);
    expect(build(days(7, () => ({}))).weekend_calorie_gap?.[7]).toBeUndefined();
  });
  it('is deterministic: same input, same output', () => {
    const a = computeFeatures({ rows: days(30, i => ({ calories: 1500 + i * 10 })), targets: TARGETS, today: TODAY, now: NOW });
    const b = computeFeatures({ rows: days(30, i => ({ calories: 1500 + i * 10 })), targets: TARGETS, today: TODAY, now: NOW });
    expect(a).toEqual(b);
  });
  it('logging streak counts back from today, or from yesterday when today is still empty', () => {
    expect(loggingStreak(days(10, () => ({})), TODAY)).toBe(10);
    expect(loggingStreak(days(10, i => (i === 0 ? null : {})), TODAY)).toBe(9);
    expect(loggingStreak(days(10, i => (i === 3 ? null : {})), TODAY)).toBe(3);
  });
  it('date helpers', () => { expect(weekStart(TODAY)).toBe('2026-10-26'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01'); });
});
