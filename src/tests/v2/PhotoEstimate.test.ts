import { describe, it, expect } from 'vitest';
import { calorieRange, rangeText, confidenceNote, chooseSource } from '../../lib/photoEstimate';

describe('calorieRange', () => {
  it('widens as confidence drops', () => {
    const h = calorieRange(400, 'high'), m = calorieRange(400, 'medium'), l = calorieRange(400, 'low');
    expect(h.high - h.low).toBeLessThan(m.high - m.low);
    expect(m.high - m.low).toBeLessThan(l.high - l.low);
  });
  it('rounds to friendly numbers', () => {
    expect(calorieRange(400, 'medium')).toEqual({ low: 300, high: 500, mid: 400 });
    expect(calorieRange(133, 'high')).toEqual({ low: 115, high: 155, mid: 135 });
    expect(calorieRange(800, 'low')).toEqual({ low: 480, high: 1120, mid: 800 });
  });
  it('never goes negative', () => { expect(calorieRange(-5, 'low').low).toBe(0); });
  it('says it is an estimate', () => { expect(rangeText(400, 'medium')).toBe('about 400 kcal (300 to 500)'); });
});

describe('confidenceNote', () => {
  it('stays quiet only when sure and nothing to ask', () => {
    expect(confidenceNote('high', false)).toBeNull();
    expect(confidenceNote('high', true)).not.toBeNull();
    expect(confidenceNote('medium', false)).not.toBeNull();
    expect(confidenceNote('low', false)).toMatch(/Not sure/);
  });
});

describe('chooseSource', () => {
  it('prefers a good food-list match', () => {
    expect(chooseSource({ dbScore: 0.1, dbCalories: 100, aiCalories: 110 })).toEqual({ source: 'food_list', disagree: null });
  });
  it('ignores a weak match', () => {
    expect(chooseSource({ dbScore: 0.5, dbCalories: 100, aiCalories: 110 }).source).toBe('ai_estimate');
    expect(chooseSource({ dbScore: null, dbCalories: null, aiCalories: 110 }).source).toBe('ai_estimate');
  });
  it('flags big disagreement either way', () => {
    expect(chooseSource({ dbScore: 0.1, dbCalories: 100, aiCalories: 180 }).disagree).toBe('higher');
    expect(chooseSource({ dbScore: 0.1, dbCalories: 100, aiCalories: 50 }).disagree).toBe('lower');
    expect(chooseSource({ dbScore: 0.1, dbCalories: 100, aiCalories: 130 }).disagree).toBeNull();
  });
});
