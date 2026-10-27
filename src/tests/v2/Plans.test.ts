import { describe, it, expect } from 'vitest';
import { checkPlan, seatAvailable, yearlySavingPct } from '../../../functions/_shared/plans';

const base = { key: 'pro_plus', audience: 'client', name: 'Pro Plus', price_inr_month: 199, entitlements: { ai_daily_limit: 400 } };

describe('plan validation', () => {
  it('accepts a good client plan', () => { const r = checkPlan(base); expect(r.ok).toBe(true); });
  it('rejects a bad key', () => { expect(checkPlan({ ...base, key: 'Bad Key' }).ok).toBe(false); });
  it('rejects unknown limits so typos do not silently do nothing', () => { expect(checkPlan({ ...base, entitlements: { ai_daily_limt: 3 } }).ok).toBe(false); });
  it('rejects fractional or negative prices', () => {
    expect(checkPlan({ ...base, price_inr_month: 99.5 }).ok).toBe(false);
    expect(checkPlan({ ...base, price_inr_month: -1 }).ok).toBe(false);
  });
  it('rejects a coach limit on a client plan and the reverse', () => {
    expect(checkPlan({ ...base, entitlements: { max_clients: 5 } }).ok).toBe(false);
    expect(checkPlan({ key: 'c2', audience: 'coach', name: 'C', entitlements: { ai_daily_limit: 5 } }).ok).toBe(false);
  });
  it('allows an empty client cap (no cap) on a coach plan', () => {
    expect(checkPlan({ key: 'c3', audience: 'coach', name: 'C', entitlements: { max_clients: null } }).ok).toBe(true);
  });
  it('rejects unknown features', () => { expect(checkPlan({ ...base, entitlements: { features: ['teleport'] } }).ok).toBe(false); });
});

describe('seats and savings', () => {
  it('no cap always has room', () => { expect(seatAvailable({ cap: null, used: 500 })).toBe(true); });
  it('stops at the cap', () => {
    expect(seatAvailable({ cap: 10, used: 9 })).toBe(true);
    expect(seatAvailable({ cap: 10, used: 10 })).toBe(false);
  });
  it('a cap of zero admits nobody', () => { expect(seatAvailable({ cap: 0, used: 0 })).toBe(false); });
  it('yearly saving is a whole percent', () => { expect(yearlySavingPct(100, 800)).toBe(33); });
  it('no saving when yearly costs the same or more', () => {
    expect(yearlySavingPct(100, 1200)).toBe(null);
    expect(yearlySavingPct(0, 500)).toBe(null);
    expect(yearlySavingPct(100, null)).toBe(null);
  });
});
