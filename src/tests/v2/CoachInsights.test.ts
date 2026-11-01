import { describe, it, expect } from 'vitest';
import { dayScore, summarise, type SeriesRow } from '../../lib/coachSeries';

const row = (client_id: string, day: string, calories: number, items: number, target_cal = 2000, protein_g = 0, target_protein = 100): SeriesRow =>
  ({ client_id, day, calories, protein_g, items, target_cal, target_protein, energy: null });

describe('dayScore (how a logged day matches the calorie target)', () => {
  it('is 0 when nothing was logged', () => { expect(dayScore(0, 0, 2000)).toBe(0); });
  it('is 1 within 10% of target', () => { expect(dayScore(2100, 3, 2000)).toBe(1); expect(dayScore(1800, 3, 2000)).toBe(1); });
  it('falls to 0 at 50% off', () => { expect(dayScore(1000, 3, 2000)).toBe(0); expect(dayScore(3000, 3, 2000)).toBe(0); });
  it('is in between for 30% off', () => { expect(dayScore(1400, 3, 2000)).toBeCloseTo(0.5, 5); });
  it('is neutral when there is no target', () => { expect(dayScore(1500, 2, null)).toBe(0.6); });
});

describe('summarise (group numbers per day)', () => {
  const s = [row('a', '2026-11-01', 2000, 3, 2000, 100), row('b', '2026-11-01', 1000, 2, 2000, 50), row('c', '2026-11-01', 0, 0),
             row('a', '2026-11-02', 2000, 3, 2000, 100), row('b', '2026-11-02', 0, 0), row('c', '2026-11-02', 0, 0)];
  const r = summarise(s);
  it('lists days in order', () => { expect(r.days).toEqual(['2026-11-01', '2026-11-02']); });
  it('averages calorie share only over people who logged', () => { expect(r.cal).toEqual([75, 100]); });
  it('averages protein share only over people who logged', () => { expect(r.pro).toEqual([75, 100]); });
  it('reports the share of clients who logged', () => { expect(r.logging).toEqual([67, 33]); });
  it('gives null, not zero, when nobody logged', () => { expect(summarise([row('a', '2026-11-03', 0, 0)]).cal).toEqual([null]); });
});
