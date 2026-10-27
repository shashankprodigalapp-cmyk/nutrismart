import { describe, it, expect } from 'vitest';
import { pct, funnel, reviewOutcome, cohortRate } from '../../lib/v2Analytics';

describe('v2 analytics helpers', () => {
  it('percent needs a whole above zero', () => { expect(pct(1, 0)).toBe(null); expect(pct(1, 4)).toBe(25); });
  it('funnel shows each step against the previous and the first', () => {
    const f = funnel([['applied', 10], ['approved', 8], ['has client', 4]]);
    expect(f[0].ofPrevious).toBe(null);
    expect(f[1].ofPrevious).toBe(80);
    expect(f[2].ofPrevious).toBe(50);
    expect(f[2].ofFirst).toBe(40);
  });
  it('funnel never shows over 100%', () => { expect(funnel([['a', 2], ['b', 5]])[1].ofPrevious).toBe(100); });
  it('funnel with an empty first step shows no percentages', () => { expect(funnel([['a', 0], ['b', 0]])[1].ofFirst).toBe(null); });
  it('review outcome ignores drafts', () => {
    const o = reviewOutcome({ draft: 20, approved: 6, edited: 2, rejected: 2 });
    expect(o.decided).toBe(10); expect(o.approvedPct).toBe(60); expect(o.rejectedPct).toBe(20);
  });
  it('review outcome with nothing decided has no percentages', () => { expect(reviewOutcome({ draft: 3 }).approvedPct).toBe(null); });
  it('small cohorts show counts, not percentages', () => {
    expect(cohortRate(2, 4)).toBe('2 of 4');
    expect(cohortRate(3, 10)).toBe('30%');
  });
});
