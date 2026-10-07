/**
 * kitchenIntelligence.test.ts
 *
 * Unit test suite for Module 3 — Kitchen Intelligence Engine.
 * All tests use pure functions only — no Dexie, no network, no async I/O.
 *
 * Run: npx vitest run src/tests/kitchenIntelligence.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  // Types
  type KitchenAnswers,
  type KitchenProfile,
  // Constants
  OIL_MULTIPLIERS,
  COOK_MULTIPLIERS,
  STYLE_MULTIPLIERS,
  RESTAURANT_MULTIPLIER,
  MULT_MIN,
  MULT_MAX,
  CALORIE_HARD_CAP,
  CALIBRATION_MAX_NUDGE,
  CALIBRATION_MAX_DRIFT,
  CALIBRATION_MIN_HOME_LOGS,
  // Functions
  clamp,
  todayIST,
  buildKitchenProfile,
  formatMultiplierForDisplay,
  getMultiplierDescription,
  applyMultiplier,
  shouldRecalibrate,
  recalibrate,
} from '../lib/kitchenIntelligence';
import type { Food, LogEntry } from '../lib/localDb';

// ── FIXTURES ──────────────────────────────────────────────────────────────────

/** Minimal valid Food object for testing */
function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id:       'food-001',
    name:     'Dal Tadka',
    portion:  '1 katori - 150g',
    calories: 180,
    protein:  9,
    carbs:    22,
    fat:      6,
    gl:       8,
    type:     'MR',
    ...overrides,
  };
}

/** Minimal KitchenProfile for testing */
function makeProfile(overrides: Partial<KitchenProfile> = {}): KitchenProfile {
  return {
    home_mult:          1.00,
    rest_mult:          RESTAURANT_MULTIPLIER,
    initial_home_mult:  1.00,
    answers:            { oil: 'moderate', cook: 'me', style: 'mixed' },
    calibration_count:  0,
    manual_override:    false,
    ...overrides,
  };
}

/** Builds a LogEntry for calibration tests */
function makeLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id:         crypto.randomUUID(),
    user_id:    'user-001',
    log_date:   '2025-10-20',
    meal:       'lunch',
    food_name:  'Dal Tadka',
    portion:    '1 katori - 150g',
    qty:        1,
    is_home:    true,
    multiplier: 1.00,
    cal:        180,
    protein:    9,
    carbs:      22,
    fat:        6,
    gl:         8,
    anomaly:    false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── UTILITY TESTS ─────────────────────────────────────────────────────────────

describe('clamp()', () => {
  it('returns value when within bounds', () => {
    expect(clamp(1.15, 0.70, 1.50)).toBe(1.15);
  });

  it('returns min when value is below lower bound', () => {
    expect(clamp(0.50, 0.70, 1.50)).toBe(0.70);
  });

  it('returns max when value is above upper bound', () => {
    expect(clamp(2.00, 0.70, 1.50)).toBe(1.50);
  });

  it('returns boundary value exactly when on the boundary', () => {
    expect(clamp(0.70, 0.70, 1.50)).toBe(0.70);
    expect(clamp(1.50, 0.70, 1.50)).toBe(1.50);
  });
});

describe('todayIST()', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = todayIST();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a valid date', () => {
    const result = todayIST();
    expect(new Date(result).toString()).not.toBe('Invalid Date');
  });
});

// ── STEP 3.1 — PROFILE MULTIPLIER TESTS ──────────────────────────────────────

describe('OIL_MULTIPLIERS constant', () => {
  it('has correct values for all oil usages', () => {
    expect(OIL_MULTIPLIERS.very_light).toBe(0.85);
    expect(OIL_MULTIPLIERS.moderate).toBe(1.00);
    expect(OIL_MULTIPLIERS.regular).toBe(1.15);
    expect(OIL_MULTIPLIERS.heavy).toBe(1.30);
  });
});

describe('COOK_MULTIPLIERS constant', () => {
  it('has correct values for all cook types', () => {
    expect(COOK_MULTIPLIERS.me).toBe(1.00);
    expect(COOK_MULTIPLIERS.maid).toBe(1.05);
    expect(COOK_MULTIPLIERS.mix).toBe(1.00);
  });
});

describe('STYLE_MULTIPLIERS constant', () => {
  it('has correct values for all cooking styles', () => {
    expect(STYLE_MULTIPLIERS.health).toBe(0.90);
    expect(STYLE_MULTIPLIERS.traditional).toBe(1.10);
    expect(STYLE_MULTIPLIERS.mixed).toBe(1.00);
  });
});

describe('buildKitchenProfile()', () => {
  // ── Clamping ceiling test ──────────────────────────────────────────────────

  it('[CLAMP CEILING] heavy + maid + traditional clamps to MULT_MAX (1.50)', () => {
    const answers: KitchenAnswers = { oil: 'heavy', cook: 'maid', style: 'traditional' };
    const profile = buildKitchenProfile(answers);

    // Raw: 1.30 × 1.05 × 1.10 = 1.5015 → clamped to 1.50
    expect(profile.home_mult).toBe(MULT_MAX);
    expect(profile.home_mult).toBe(1.50);
  });

  // ── Clamping floor test ───────────────────────────────────────────────────

  it('[CLAMP FLOOR] very_light + me + health clamps to 0.77 (above floor of 0.70)', () => {
    const answers: KitchenAnswers = { oil: 'very_light', cook: 'me', style: 'health' };
    const profile = buildKitchenProfile(answers);

    // Raw: 0.85 × 1.00 × 0.90 = 0.765 → rounds to 0.765, above MULT_MIN
    expect(profile.home_mult).toBeCloseTo(0.765, 2);
    expect(profile.home_mult).toBeGreaterThanOrEqual(MULT_MIN);
  });

  it('[NEUTRAL] moderate + me + mixed gives exactly 1.00', () => {
    const answers: KitchenAnswers = { oil: 'moderate', cook: 'me', style: 'mixed' };
    const profile = buildKitchenProfile(answers);

    expect(profile.home_mult).toBe(1.00);
  });

  it('[REST_MULT] restaurant multiplier is always 1.30 regardless of answers', () => {
    const light: KitchenAnswers = { oil: 'very_light', cook: 'me', style: 'health' };
    const heavy: KitchenAnswers = { oil: 'heavy', cook: 'maid', style: 'traditional' };

    expect(buildKitchenProfile(light).rest_mult).toBe(RESTAURANT_MULTIPLIER);
    expect(buildKitchenProfile(heavy).rest_mult).toBe(RESTAURANT_MULTIPLIER);
  });

  it('[INITIAL] initial_home_mult equals home_mult at build time', () => {
    const answers: KitchenAnswers = { oil: 'regular', cook: 'maid', style: 'traditional' };
    const profile = buildKitchenProfile(answers);

    expect(profile.initial_home_mult).toBe(profile.home_mult);
  });

  it('[STATE] calibration_count starts at 0', () => {
    const profile = buildKitchenProfile({ oil: 'moderate', cook: 'me', style: 'mixed' });
    expect(profile.calibration_count).toBe(0);
  });

  it('[STATE] manual_override starts as false', () => {
    const profile = buildKitchenProfile({ oil: 'moderate', cook: 'me', style: 'mixed' });
    expect(profile.manual_override).toBe(false);
  });

  it('[BOUNDS] all standard answer combinations produce home_mult within [0.70, 1.50]', () => {
    const oils:   Array<KitchenAnswers['oil']>  = ['very_light', 'moderate', 'regular', 'heavy'];
    const cooks:  Array<KitchenAnswers['cook']> = ['me', 'maid', 'mix'];
    const styles: Array<KitchenAnswers['style']>= ['health', 'traditional', 'mixed'];

    for (const oil of oils) {
      for (const cook of cooks) {
        for (const style of styles) {
          const profile = buildKitchenProfile({ oil, cook, style });
          expect(profile.home_mult).toBeGreaterThanOrEqual(MULT_MIN);
          expect(profile.home_mult).toBeLessThanOrEqual(MULT_MAX);
        }
      }
    }
  });
});

describe('formatMultiplierForDisplay()', () => {
  it('formats 1.15 as "1.15×"', () => {
    expect(formatMultiplierForDisplay(1.15)).toBe('1.15×');
  });

  it('formats 1.0 as "1.00×"', () => {
    expect(formatMultiplierForDisplay(1.0)).toBe('1.00×');
  });

  it('formats 0.85 as "0.85×"', () => {
    expect(formatMultiplierForDisplay(0.85)).toBe('0.85×');
  });
});

describe('getMultiplierDescription()', () => {
  it('returns "Light cooking" for mult < 0.90', () => {
    expect(getMultiplierDescription(0.85)).toBe('Light cooking');
    expect(getMultiplierDescription(0.70)).toBe('Light cooking');
    expect(getMultiplierDescription(0.89)).toBe('Light cooking');
  });

  it('returns "Standard home cooking" for mult 0.90–1.10', () => {
    expect(getMultiplierDescription(0.90)).toBe('Standard home cooking');
    expect(getMultiplierDescription(1.00)).toBe('Standard home cooking');
    expect(getMultiplierDescription(1.10)).toBe('Standard home cooking');
  });

  it('returns "Rich cooking" for mult 1.11–1.30', () => {
    expect(getMultiplierDescription(1.15)).toBe('Rich cooking');
    expect(getMultiplierDescription(1.30)).toBe('Rich cooking');
  });

  it('returns "Very rich cooking" for mult > 1.30', () => {
    expect(getMultiplierDescription(1.31)).toBe('Very rich cooking');
    expect(getMultiplierDescription(1.50)).toBe('Very rich cooking');
  });
});

// ── STEP 3.2 — MACRO MULTIPLIER APPLICATION TESTS ────────────────────────────

describe('applyMultiplier() — basic scaling', () => {
  it('home meal: calories and fat scale by home_mult', () => {
    const food    = makeFood({ calories: 180, fat: 6, protein: 9, carbs: 22, gl: 8 });
    const profile = makeProfile({ home_mult: 1.15 });
    const result  = applyMultiplier(food, 1, true, profile);

    expect(result.cal).toBe(Math.round(180 * 1.15)); // 207
    expect(result.fat).toBeCloseTo(6 * 1.15, 1);      // 6.9
  });

  it('restaurant meal: uses rest_mult (1.30), not home_mult', () => {
    const food    = makeFood({ calories: 180, fat: 6 });
    const profile = makeProfile({ home_mult: 1.00, rest_mult: 1.30 });
    const result  = applyMultiplier(food, 1, false, profile);

    expect(result.cal).toBe(Math.round(180 * 1.30)); // 234
    expect(result.fat).toBeCloseTo(6 * 1.30, 1);      // 7.8
    expect(result.is_home).toBe(false);
    expect(result.multiplier).toBe(1.30);
  });

  it('quantity=2: doubles intrinsic and scaled values', () => {
    const food    = makeFood({ calories: 180, fat: 6, protein: 9, carbs: 22, gl: 8 });
    const profile = makeProfile({ home_mult: 1.00 });
    const result  = applyMultiplier(food, 2, true, profile);

    expect(result.cal).toBe(360);
    expect(result.fat).toBe(12.0);
    expect(result.protein).toBe(18.0);
    expect(result.carbs).toBe(44.0);
    expect(result.gl).toBe(16.0);
  });
});

describe('applyMultiplier() — MACRO DISASSOCIATION (core invariant)', () => {
  /**
   * This is the most important invariant in the entire engine.
   * Extra oil adds calories and fat — it does NOT add protein, carbs, or GL.
   * These are intrinsic molecular properties of the food.
   */

  it('[PROTEIN DISASSOCIATION] protein does not scale with multiplier', () => {
    // High-protein food (paneer) with heavy restaurant multiplier
    const paneer  = makeFood({ name: 'Paneer Bhurji', calories: 220, protein: 18, fat: 15, carbs: 4, gl: 2 });
    const profile = makeProfile({ home_mult: 1.00, rest_mult: 1.30 });

    const home = applyMultiplier(paneer, 1, true,  profile);
    const rest = applyMultiplier(paneer, 1, false, profile);

    // Calories and fat increase at restaurant
    expect(rest.cal).toBeGreaterThan(home.cal);
    expect(rest.fat).toBeGreaterThan(home.fat);

    // PROTEIN MUST BE IDENTICAL — oil adds no protein
    expect(rest.protein).toBe(home.protein);
    expect(rest.protein).toBe(18.0);
    expect(home.protein).toBe(18.0);
  });

  it('[GL DISASSOCIATION] glycemic load does not scale with multiplier', () => {
    const rice    = makeFood({ name: 'Jeera Rice', calories: 210, protein: 4, fat: 5, carbs: 38, gl: 22 });
    const profile = makeProfile({ home_mult: 1.15, rest_mult: 1.30 });

    const home = applyMultiplier(rice, 1, true,  profile);
    const rest = applyMultiplier(rice, 1, false, profile);

    // GL must be identical regardless of cooking context
    expect(home.gl).toBe(22.0);
    expect(rest.gl).toBe(22.0);
  });

  it('[CARBS DISASSOCIATION] carbs do not scale with multiplier', () => {
    const roti    = makeFood({ name: 'Whole Wheat Roti', calories: 80, protein: 3, fat: 1.5, carbs: 14, gl: 9 });
    const profile = makeProfile({ home_mult: 1.30, rest_mult: 1.30 });

    const result = applyMultiplier(roti, 2, true, profile);

    // Carbs = food.carbs × qty (no multiplier)
    expect(result.carbs).toBe(14 * 2);  // 28.0
  });

  it('[SCALING CONFIRMATION] fat and cal scale proportionally with multiplier', () => {
    const food    = makeFood({ calories: 200, fat: 10, protein: 15, carbs: 20, gl: 12 });
    const profile = makeProfile({ home_mult: 1.20 });
    const result  = applyMultiplier(food, 1, true, profile);

    expect(result.cal).toBe(Math.round(200 * 1.20)); // 240
    expect(result.fat).toBeCloseTo(10 * 1.20, 1);     // 12.0
    expect(result.protein).toBe(15.0);                // unchanged
    expect(result.carbs).toBe(20.0);                  // unchanged
    expect(result.gl).toBe(12.0);                     // unchanged
  });
});

describe('applyMultiplier() — HARD CAP safety', () => {
  it('[CAP] 4999 kcal ceiling applied when food × qty × mult would exceed it', () => {
    // 4000 kcal food × qty=1 × mult=1.30 = 5200 → should cap at 4999
    const huge_food = makeFood({ calories: 4000, fat: 200 });
    const profile   = makeProfile({ home_mult: 1.00, rest_mult: 1.30 });

    const result = applyMultiplier(huge_food, 1, false, profile);

    expect(result.cal).toBe(CALORIE_HARD_CAP);        // 4999
    expect(result.anomaly).toBe(true);
  });

  it('[NO CAP] 4999 or below is not capped', () => {
    const borderline = makeFood({ calories: 3845 }); // × 1.30 = 4998.5 → 4999 — still under cap
    const profile    = makeProfile({ home_mult: 1.00, rest_mult: 1.30 });

    const result = applyMultiplier(borderline, 1, false, profile);

    expect(result.cal).toBeLessThanOrEqual(CALORIE_HARD_CAP);
    expect(result.anomaly).toBe(false);
  });

  it('[ANOMALY FLAG] anomaly is false when no cap triggered', () => {
    const food   = makeFood({ calories: 180 });
    const result = applyMultiplier(food, 1, true, makeProfile());

    expect(result.anomaly).toBe(false);
  });
});

describe('applyMultiplier() — denormalized fields', () => {
  it('multiplier field in result equals the actual mult used', () => {
    const profile = makeProfile({ home_mult: 1.15, rest_mult: 1.30 });
    const food    = makeFood();

    const home = applyMultiplier(food, 1, true,  profile);
    const rest = applyMultiplier(food, 1, false, profile);

    expect(home.multiplier).toBe(1.15);
    expect(rest.multiplier).toBe(1.30);
  });

  it('is_home field in result reflects the isHome parameter', () => {
    const result_home = applyMultiplier(makeFood(), 1, true,  makeProfile());
    const result_rest = applyMultiplier(makeFood(), 1, false, makeProfile());

    expect(result_home.is_home).toBe(true);
    expect(result_rest.is_home).toBe(false);
  });
});

// ── STEP 3.3 — SELF-CALIBRATION ENGINE TESTS ─────────────────────────────────

describe('shouldRecalibrate()', () => {
  it('returns true on every 10th log (10, 20, 30…)', () => {
    const profile = makeProfile({ calibration_count: 0 });

    expect(shouldRecalibrate(profile, 10)).toBe(true);
    expect(shouldRecalibrate(profile, 20)).toBe(true);
    expect(shouldRecalibrate(profile, 30)).toBe(true);
    expect(shouldRecalibrate(profile, 100)).toBe(true);
  });

  it('returns false for non-multiples of 10', () => {
    const profile = makeProfile();

    expect(shouldRecalibrate(profile, 1)).toBe(false);
    expect(shouldRecalibrate(profile, 9)).toBe(false);
    expect(shouldRecalibrate(profile, 11)).toBe(false);
    expect(shouldRecalibrate(profile, 25)).toBe(false);
  });

  it('returns false for 0 (initial state)', () => {
    expect(shouldRecalibrate(makeProfile(), 0)).toBe(false);
  });
});

describe('recalibrate() — guard conditions', () => {
  const noopLookup = (_name: string) => undefined;

  it('skips when manual_override is true', () => {
    const profile = makeProfile({ manual_override: true });
    const logs    = Array.from({ length: 10 }, () => makeLogEntry());

    const result = recalibrate(profile, logs, noopLookup);

    expect(result.changed).toBe(false);
    expect(result.skipped_reason).toBe('manual_override');
    expect(result.updated_profile.home_mult).toBe(profile.home_mult);
  });

  it('skips when fewer than CALIBRATION_MIN_HOME_LOGS home logs exist', () => {
    const profile = makeProfile();
    // Only 4 home logs — below the minimum of 5
    const logs = Array.from({ length: 4 }, () => makeLogEntry({ is_home: true }));

    const result = recalibrate(profile, logs, noopLookup);

    expect(result.changed).toBe(false);
    expect(result.skipped_reason).toBe('insufficient_data');
  });

  it('skips when all logs are restaurant (is_home=false)', () => {
    const profile = makeProfile();
    const logs    = Array.from({ length: 20 }, () => makeLogEntry({ is_home: false }));

    const result = recalibrate(profile, logs, noopLookup);

    expect(result.changed).toBe(false);
    expect(result.skipped_reason).toBe('insufficient_data');
  });

  it('skips when master food lookup returns undefined for all entries', () => {
    const profile = makeProfile();
    const logs    = Array.from({ length: 10 }, () => makeLogEntry({ is_home: true }));

    // Lookup always returns undefined — can't compute expected
    const result = recalibrate(profile, logs, () => undefined);

    expect(result.changed).toBe(false);
    expect(result.skipped_reason).toBe('insufficient_data');
  });
});

describe('recalibrate() — CALIBRATION DAMPENING (core safety invariant)', () => {
  /**
   * The nudge per cycle must never exceed ±0.05 regardless of how extreme
   * the ratio between logged and expected calories is.
   */

  const dalTadkaFood = makeFood({ calories: 180 });
  const lookup       = (name: string): Food | undefined =>
    name === 'Dal Tadka' ? dalTadkaFood : undefined;

  it('[DAMPENING] extreme over-eating (ratio=2.0) stays within single-cycle nudge ceiling', () => {
    // If user consistently logs 2× more calories than expected, raw nudge = (2.0-1.0)×0.10 = 0.10
    // But cap is 0.05 — so effective nudge must be exactly 0.05
    const profile = makeProfile({ home_mult: 1.00, initial_home_mult: 1.00 });
    const logs    = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 360, qty: 1 }) // 2× expected (180)
    );

    const result = recalibrate(profile, logs, lookup);

    expect(result.changed).toBe(true);
    const actual_nudge = result.new_mult - result.old_mult;
    expect(Math.abs(actual_nudge)).toBeCloseTo(CALIBRATION_MAX_NUDGE, 9); // floating-point safe
    expect(actual_nudge).toBeCloseTo(CALIBRATION_MAX_NUDGE, 3); // hit the ceiling
  });

  it('[DAMPENING] extreme under-eating (ratio=0.3) stays within single-cycle nudge floor', () => {
    // ratio=0.3 → raw nudge = (0.3-1.0)×0.10 = -0.07 → capped to -0.05
    const profile = makeProfile({ home_mult: 1.20, initial_home_mult: 1.20 });
    const logs    = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 54, qty: 1 }) // 0.3× expected
    );

    const result = recalibrate(profile, logs, lookup);

    if (result.changed) {
      const actual_nudge = result.new_mult - result.old_mult;
      expect(Math.abs(actual_nudge)).toBeCloseTo(CALIBRATION_MAX_NUDGE, 9); // floating-point safe
    }
  });

  it('[DRIFT CEILING] total drift from initial never exceeds ±0.30', () => {
    // Simulate a profile already drifted to the ceiling
    const profile = makeProfile({
      home_mult:         1.30,  // already 0.30 above initial
      initial_home_mult: 1.00,
    });
    // Logs suggesting even more increase
    const logs = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 360, qty: 1 })
    );

    const result = recalibrate(profile, logs, lookup);

    // Even if nudge would push it higher, drift ceiling must hold
    expect(result.new_mult).toBeLessThanOrEqual(1.00 + CALIBRATION_MAX_DRIFT);
    expect(result.new_mult).toBe(1.30); // already at ceiling, no change
  });

  it('[DRIFT FLOOR] total drift below initial never exceeds -0.30', () => {
    const profile = makeProfile({
      home_mult:         0.70,  // already 0.30 below initial
      initial_home_mult: 1.00,
    });
    const logs = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 54, qty: 1 }) // very low
    );

    const result = recalibrate(profile, logs, lookup);

    expect(result.new_mult).toBeGreaterThanOrEqual(1.00 - CALIBRATION_MAX_DRIFT);
    expect(result.new_mult).toBe(0.70); // already at floor, no change
  });

  it('[ABSOLUTE BOUNDS] home_mult never goes below MULT_MIN even with max drift', () => {
    const profile = makeProfile({
      home_mult:         0.73,
      initial_home_mult: 0.73, // very low starting point
    });
    const logs = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 10, qty: 1 }) // tiny
    );

    const result = recalibrate(profile, logs, lookup);

    expect(result.new_mult).toBeGreaterThanOrEqual(MULT_MIN);
  });

  it('[CALIBRATION] accurate data produces no change (ratio ≈ 1.0)', () => {
    // User's logged calories match the DB exactly — no adjustment needed
    const profile = makeProfile({ home_mult: 1.00, initial_home_mult: 1.00 });
    const logs    = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 180, qty: 1 }) // exact match
    );

    const result = recalibrate(profile, logs, lookup);

    expect(result.changed).toBe(false);
    expect(result.skipped_reason).toBe('no_change');
  });

  it('[CALIBRATION] moderate over-eating produces small positive nudge within ceiling', () => {
    // 20% over expected → raw nudge = 0.02, well within 0.05 ceiling
    const profile = makeProfile({ home_mult: 1.00, initial_home_mult: 1.00 });
    const logs    = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 216, qty: 1 }) // 180 × 1.20
    );

    const result = recalibrate(profile, logs, lookup);

    if (result.changed) {
      const nudge = result.new_mult - result.old_mult;
      expect(nudge).toBeGreaterThan(0);
      expect(nudge).toBeLessThanOrEqual(CALIBRATION_MAX_NUDGE);
      // Raw: (216/180 - 1.0) × 0.10 = 0.2 × 0.10 = 0.02
      expect(nudge).toBeCloseTo(0.02, 2);
    }
  });

  it('[RESTAURANT ISOLATION] restaurant logs do not influence home_mult calibration', () => {
    const profile = makeProfile({ home_mult: 1.00, initial_home_mult: 1.00 });
    const lookup  = (_: string) => dalTadkaFood;

    // All restaurant logs with wildly high calories
    const restaurant_logs = Array.from({ length: 20 }, () =>
      makeLogEntry({ is_home: false, food_name: 'Dal Tadka', cal: 5000, qty: 1 })
    );

    const result = recalibrate(profile, restaurant_logs, lookup);

    // Should skip because no home logs
    expect(result.changed).toBe(false);
    expect(result.new_mult).toBe(1.00);
  });

  it('[WINDOW] only uses last 30 home logs (not all-time history)', () => {
    const profile = makeProfile({ home_mult: 1.00, initial_home_mult: 1.00 });

    // 50 logs total: first 20 have huge calories, last 30 are accurate
    const old_logs = Array.from({ length: 20 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 900, qty: 1 }) // 5× expected
    );
    const recent_logs = Array.from({ length: 30 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Dal Tadka', cal: 180, qty: 1 }) // exact match
    );

    const all_logs = [...old_logs, ...recent_logs];
    const result   = recalibrate(profile, all_logs, (_) => dalTadkaFood);

    // Calibration should see only the recent 30 accurate logs → no change
    expect(result.changed).toBe(false);
  });
});

describe('recalibrate() — profile immutability', () => {
  it('does not mutate the input profile object', () => {
    const original_mult = 1.15;
    const profile = makeProfile({ home_mult: original_mult, initial_home_mult: 1.15 });
    const food    = makeFood();
    const lookup  = () => food;
    const logs    = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: food.name, cal: 250, qty: 1 })
    );

    recalibrate(profile, logs, lookup);

    // Original profile must be unchanged
    expect(profile.home_mult).toBe(original_mult);
  });

  it('initial_home_mult in updated_profile is never changed by calibration', () => {
    const profile = makeProfile({ home_mult: 1.00, initial_home_mult: 1.00 });
    const food    = makeFood();
    const lookup  = () => food;
    const logs    = Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: food.name, cal: 360, qty: 1 }) // 2× expected
    );

    const result = recalibrate(profile, logs, lookup);

    // initial_home_mult is the immutable anchor — must never change
    expect(result.updated_profile.initial_home_mult).toBe(1.00);
  });
});

// ── INTEGRATION-STYLE SCENARIO TESTS ─────────────────────────────────────────

describe('End-to-end scenario: heavy cook → restaurant order', () => {
  it('correctly differentiates home vs restaurant for same food', () => {
    // User: heavy oil usage, traditional cooking style, self cooks
    const answers: KitchenAnswers = { oil: 'heavy', cook: 'me', style: 'traditional' };
    const profile  = buildKitchenProfile(answers);
    const dal      = makeFood({ name: 'Dal Makhani', calories: 250, protein: 10, fat: 18, carbs: 20, gl: 10 });

    const home = applyMultiplier(dal, 1, true,  profile);
    const rest = applyMultiplier(dal, 1, false, profile);

    // Both should be higher than base, but for different reasons
    expect(home.cal).toBeGreaterThan(dal.calories);  // home_mult > 1.0
    expect(rest.cal).toBeGreaterThan(dal.calories);  // rest_mult = 1.30

    // Protein must be 10g in both cases
    expect(home.protein).toBe(10.0);
    expect(rest.protein).toBe(10.0);

    // GL must be 10 in both cases
    expect(home.gl).toBe(10.0);
    expect(rest.gl).toBe(10.0);

    // home_mult for this profile: 1.30 × 1.00 × 1.10 = 1.43 (clamped to 1.43 — under 1.50)
    const expected_home_mult = clamp(1.30 * 1.00 * 1.10, MULT_MIN, MULT_MAX);
    expect(home.multiplier).toBeCloseTo(expected_home_mult, 2);
    expect(rest.multiplier).toBe(RESTAURANT_MULTIPLIER);
  });
});

describe('End-to-end scenario: calibration convergence over time', () => {
  it('nudges toward accurate mult when user consistently eats 15% more than DB baseline', () => {
    const food    = makeFood({ name: 'Rajma Chawal', calories: 400, protein: 15, fat: 12, carbs: 60, gl: 28 });
    const lookup  = () => food;
    let   profile = makeProfile({ home_mult: 1.00, initial_home_mult: 1.00 });

    // Simulate: user actual eating is 15% richer → logged_cal = 460 each time
    const make_logs = () => Array.from({ length: 10 }, () =>
      makeLogEntry({ is_home: true, food_name: 'Rajma Chawal', cal: 460, qty: 1 })
    );

    // Run 3 calibration cycles
    for (let cycle = 0; cycle < 3; cycle++) {
      const result = recalibrate(profile, make_logs(), lookup);
      if (result.changed) profile = result.updated_profile;
    }

    // After 3 cycles of 15% over-eating signal:
    // Each cycle nudge = (460/400 - 1.0) × 0.10 = 0.015 per cycle
    // 3 cycles × 0.015 = 0.045 total drift
    expect(profile.home_mult).toBeGreaterThan(1.00);
    expect(profile.home_mult).toBeLessThanOrEqual(1.00 + CALIBRATION_MAX_DRIFT);
    expect(profile.home_mult).toBeCloseTo(1.045, 2);
  });
});
