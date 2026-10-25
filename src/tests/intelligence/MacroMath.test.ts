import { describe, it, expect } from 'vitest';
import { fitMacros, presetGrams, matchPreset, PRESETS, type PresetKey } from '../../lib/macroMath';

const kcal = (r: { protein: number; fat: number; carbs: number }) => 4 * r.protein + 9 * r.fat + 4 * r.carbs;

describe('fitMacros', () => {
  it('200 g protein + 200 g fat on 1500 kcal becomes possible, protein protected', () => {
    const r = fitMacros(1500, 200, 200);
    expect(r.adjusted).toBe(true);
    expect(kcal(r)).toBeLessThanOrEqual(1500);
    expect(r.carbs).toBeGreaterThanOrEqual(50);
    expect(r.protein).toBeGreaterThan(r.fat);
  });
  it('leaves realistic goals alone (including a higher-fat one)', () => {
    for (const [c, p, f] of [[1500, 90, 90], [1400, 150, 65], [2000, 120, 65]]) {
      const r = fitMacros(c, p, f);
      expect(r.adjusted).toBe(false);
      expect(r.protein).toBe(p);
      expect(r.fat).toBe(f);
    }
  });
  it('never exceeds the calorie goal', () => {
    for (const [c, p, f] of [[1200, 250, 10], [800, 150, 100], [300, 100, 100], [2500, 400, 300]]) {
      expect(kcal(fitMacros(c, p, f))).toBeLessThanOrEqual(c);
    }
  });
});

describe('presets', () => {
  it('every preset fits its calories and is recognised again', () => {
    for (const k of Object.keys(PRESETS) as PresetKey[]) {
      const g = presetGrams(k, 1500);
      const r = fitMacros(1500, g.protein, g.fat);
      expect(r.adjusted).toBe(false);
      expect(matchPreset(1500, g.protein, g.fat)).toBe(k);
    }
  });
});
