import { describe, it, expect } from 'vitest';
import { buildFindings, tryTomorrow, lowMoodNote, compare, confidenceFor, trend, type DayRow, type MealFeeling } from '../../lib/moodInsights';

let n = 0;
const day = (p: Partial<DayRow> = {}): DayRow => ({ date: `2026-10-${String(++n).padStart(2, '0')}`, mood: 3, energy: 3, hunger: 3, sleep: null, stress: null, protein: null, mealsLogged: 3, waterGlasses: null, ...p });
const many = (k: number, p: Partial<DayRow>) => Array.from({ length: k }, () => day(p));
const opts = { proteinTarget: 100, waterGoal: 8 };

describe('observation rules', () => {
  it('needs at least 3 check-in days', () => {
    expect(buildFindings([day(), day()], [], opts).findings).toEqual([]);
    expect(buildFindings([day(), day()], [], opts).confidence).toBe('insufficient');
  });
  it('confidence grows with days', () => { expect(confidenceFor(3)).toBe('early'); expect(confidenceFor(7)).toBe('emerging'); expect(confidenceFor(15)).toBe('repeated'); });
  it('each comparison group needs 3 days', () => {
    const days = [...many(4, { sleep: 'good', mood: 4 }), ...many(2, { sleep: 'poor', mood: 2 })];
    expect(compare(days, 'mood', d => d.sleep === 'good', d => d.sleep === 'poor')).toBeNull();
  });
  it('ignores differences under 0.5', () => {
    const days = [...many(4, { sleep: 'good', mood: 3.2 }), ...many(4, { sleep: 'poor', mood: 3 })];
    expect(buildFindings(days, [], opts).findings.filter(f => f.id === 'sleep_mood')).toEqual([]);
  });
});

describe('findings', () => {
  const days = [...many(5, { sleep: 'good', mood: 4, protein: 90 }), ...many(4, { sleep: 'poor', mood: 2, protein: 60 })];
  const r = buildFindings(days, [], opts);
  it('reports sleep and protein with the real numbers', () => {
    const s = r.findings.find(f => f.id === 'sleep_mood')!;
    expect(s.text).toContain('average 4 over 5 days');
    expect(s.text).toContain('average 2 over 4 days');
    expect(r.findings.some(f => f.id === 'protein_mood')).toBe(true);
    expect(r.confidence).toBe('emerging');
  });
  it('uses cautious wording, never causal', () => {
    for (const f of r.findings) { expect(f.text).not.toMatch(/\bcaus|\bbecause\b|\bdue to\b|\bleads? to\b/i); expect(f.text).toMatch(/tended/); }
  });
  it('actions come only from real findings, max 3, no duplicates', () => {
    const a = tryTomorrow(r.findings);
    expect(a.length).toBeGreaterThan(0); expect(a.length).toBeLessThanOrEqual(3);
    expect(new Set(a).size).toBe(a.length);
    expect(tryTomorrow([])).toEqual([]);
  });
  it('no action when the "worse" side is the one the person usually does', () => {
    const rev = [...many(4, { sleep: 'good', mood: 2 }), ...many(4, { sleep: 'poor', mood: 4 })];
    const f = buildFindings(rev, [], opts).findings.find(x => x.id === 'sleep_mood')!;
    expect(f.action).toBeUndefined();
  });
});

describe('after-meal observations', () => {
  const fl = (meal: string, c: MealFeeling['energy_change'], i: number): MealFeeling => ({ date: `2026-10-${i + 1}`, meal, energy_change: c, fullness: null, mood_change: null });
  it('reports a meal when energy felt lower on at least half of 3+ days', () => {
    const f = [fl('lunch', 'lower', 0), fl('lunch', 'lower', 1), fl('lunch', 'same', 2), fl('lunch', 'lower', 3)];
    const r = buildFindings(many(4, {}), f, opts).findings.find(x => x.id === 'after_lunch')!;
    expect(r.text).toContain('3 of 4');
  });
  it('stays quiet with fewer than 3 notes or mostly fine meals', () => {
    expect(buildFindings(many(4, {}), [fl('lunch', 'lower', 0), fl('lunch', 'lower', 1)], opts).findings.some(x => x.id === 'after_lunch')).toBe(false);
    expect(buildFindings(many(4, {}), [fl('dinner', 'same', 0), fl('dinner', 'same', 1), fl('dinner', 'lower', 2)], opts).findings.some(x => x.id === 'after_dinner')).toBe(false);
  });
});

describe('safety note and trend', () => {
  it('shows a gentle note only after 5+ low check-ins', () => {
    expect(lowMoodNote(many(4, { mood: 1 }))).toBeNull();
    expect(lowMoodNote(many(6, { mood: 2 }))).toMatch(/not a medical service/);
    expect(lowMoodNote(many(6, { mood: 3 }))).toBeNull();
  });
  it('trend sorts by date and skips empty days', () => {
    const t = trend([day({ date: '2026-11-02', mood: 2 }), day({ date: '2026-11-01', mood: 4 }), day({ date: '2026-11-03', mood: null })], 'mood');
    expect(t.map(x => x.date)).toEqual(['2026-11-01', '2026-11-02']);
  });
});
