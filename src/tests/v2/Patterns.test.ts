import { describe, it, expect } from 'vitest';
import { findPatterns, emptyReason, confidenceFor, type MealOutcome } from '../../lib/patterns';

let i = 0;
const meal = (p: Partial<MealOutcome>): MealOutcome => ({ log_date: `2026-10-${String(++i).padStart(2, '0')}`, meal: 'lunch', cal: 500, protein: 30, carbs: 50, fat: 15, gl: 10, logged_hour: 13, energy_level: null, energy_change: null, fullness: null, mood_change: null, ...p });
const rep = (k: number, p: Partial<MealOutcome>) => Array.from({ length: k }, () => meal(p));

describe('findPatterns', () => {
  it('says nothing with fewer than 3 observations', () => {
    expect(findPatterns(rep(2, { energy_change: 'lower' })).patterns).toEqual([]);
    expect(emptyReason(findPatterns(rep(2, { energy_change: 'lower' })).observed)).toMatch(/at least 3/);
  });
  it('finds low energy after carb-heavy meals', () => {
    const meals = [...rep(4, { carbs: 110, cal: 600, protein: 12, energy_change: 'lower' }), ...rep(1, { carbs: 110, cal: 600, protein: 12, energy_change: 'same' }),
                   ...rep(5, { carbs: 40, cal: 500, protein: 35, energy_change: 'same' })];
    const r = findPatterns(meals).patterns;
    const p = r.find(x => x.id === 'low_energy:carbs')!;
    expect(p.a.hits).toBe(4);
    expect(p.text).toContain('4 of 5'); expect(p.text).toContain('0 of 5');
    expect(p.confidence).toBe('emerging');
    const pr = r.find(x => x.id === 'low_energy:protein')!;       // the same meals are also the low-protein ones, reported honestly
    expect(pr.a.label).toBe('meals with less protein'); expect(pr.a.hits).toBe(4);
  });
  it('needs 3 meals on each side', () => {
    const meals = [...rep(4, { cal: 900, energy_change: 'lower' }), ...rep(2, { cal: 300, energy_change: 'same' })];
    expect(findPatterns(meals).patterns.some(x => x.id === 'low_energy:size')).toBe(false);
  });
  it('ignores small gaps', () => {
    const meals = [...rep(5, { cal: 900, energy_change: 'lower' }), ...rep(5, { cal: 300, energy_change: 'lower' })];
    expect(findPatterns(meals).patterns.some(x => x.id === 'low_energy:size')).toBe(false);
  });
  it('uses the older energy level when there is no after-meal note', () => {
    const meals = [...rep(4, { cal: 900, energy_level: 'low' }), ...rep(4, { cal: 300, energy_level: 'high' })];
    expect(findPatterns(meals).patterns.some(x => x.id === 'low_energy:size')).toBe(true);
  });
  it('finds hunger after low-protein meals and late meals', () => {
    const meals = [...rep(4, { protein: 8, fullness: 'hungry' }), ...rep(4, { protein: 35, fullness: 'comfortable' }), ...rep(3, { logged_hour: 22, mood_change: 'lower' }), ...rep(3, { logged_hour: 13, mood_change: 'same' })];
    const ids = findPatterns(meals).patterns.map(x => x.id);
    expect(ids).toContain('hungry_after:protein'); expect(ids).toContain('low_mood:late');
  });
  it('never uses causal wording', () => {
    const meals = [...rep(4, { cal: 900, energy_change: 'lower' }), ...rep(4, { cal: 300, energy_change: 'same' })];
    for (const p of findPatterns(meals).patterns) expect(p.text).not.toMatch(/\bcaus(e|ed|es)\b|\bbecause\b|\bdue to\b/i);
  });
  it('confidence thresholds', () => { expect(confidenceFor(2)).toBe('insufficient'); expect(confidenceFor(3)).toBe('early'); expect(confidenceFor(7)).toBe('emerging'); expect(confidenceFor(15)).toBe('repeated'); });
});
