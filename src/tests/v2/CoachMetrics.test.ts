import { describe, it, expect } from 'vitest';
import { classify, pct, daysSince, type ClientMetrics } from '../../lib/coachMetrics';

const base: ClientMetrics = {
  share_scope: { food: true, energy: true }, link_status: 'active', days_in_window: 7, days_logged: 7,
  avg_cal: 1900, avg_protein: 110, target_cal: 2000, target_protein: 120,
  energy_checkins: 5, energy_avg: 2.2, energy_prev_avg: 2.2, last_activity: new Date().toISOString(),
};

describe('classify', () => {
  it('is on track when everything is near target', () => { expect(classify(base).status).toBe('on_track'); });
  it('flags low logging as attention with the numbers', () => {
    const r = classify({ ...base, days_logged: 2 });
    expect(r.status).toBe('attention'); expect(r.reasons[0].text).toContain('2 of 7');
  });
  it('flags 3-4 logged days as drifting', () => { expect(classify({ ...base, days_logged: 4 }).status).toBe('drifting'); });
  it('flags low protein (61% drifting, 55% attention)', () => {
    expect(classify({ ...base, avg_protein: 74 }).status).toBe('drifting');
    expect(classify({ ...base, avg_protein: 66 }).status).toBe('attention');
  });
  it('flags calories far off target in either direction', () => {
    expect(classify({ ...base, avg_cal: 1200 }).status).toBe('attention');
    expect(classify({ ...base, avg_cal: 2800 }).status).toBe('attention');
    expect(classify({ ...base, avg_cal: 2400 }).status).toBe('drifting');
  });
  it('flags an energy drop of 20 percent or more', () => {
    const r = classify({ ...base, energy_avg: 1.7 });
    expect(r.status).toBe('attention'); expect(r.reasons.some(x => x.signal === 'energy_decline')).toBe(true);
  });
  it('reports no_activity when nothing logged for a week', () => {
    const old = new Date(Date.now() - 9 * 86_400_000).toISOString();
    expect(classify({ ...base, days_logged: 0, last_activity: old }).status).toBe('no_activity');
    expect(classify({ ...base, days_logged: 0, last_activity: null }).status).toBe('no_activity');
  });
  it('never judges data the client did not share', () => {
    const r = classify({ ...base, share_scope: { food: false, energy: false }, days_logged: null, avg_cal: null, avg_protein: null, energy_avg: null });
    expect(r.status).toBe('on_track'); expect(r.reasons).toHaveLength(0);
  });
  it('shows paused links as paused', () => { expect(classify({ ...base, link_status: 'paused' }).status).toBe('paused'); });
});

describe('helpers', () => {
  it('pct handles nulls and zero targets', () => {
    expect(pct(90, 120)).toBe(75); expect(pct(null, 120)).toBeNull(); expect(pct(5, 0)).toBeNull();
  });
  it('daysSince', () => { expect(daysSince(null)).toBeNull(); expect(daysSince(new Date(Date.now() - 3 * 86_400_000 - 1000).toISOString())).toBe(3); });
});
