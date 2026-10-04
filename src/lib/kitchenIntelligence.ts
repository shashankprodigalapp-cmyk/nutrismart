/**
 * kitchenIntelligence.ts — NutriSmart Kitchen Intelligence Engine (KIE)
 *
 * The core USP of NutriSmart: calorie estimates that reflect YOUR kitchen,
 * not a generic recipe database.
 *
 * ─── ARCHITECTURAL RULES ────────────────────────────────────────────────────
 *
 * 1. PURE FUNCTIONS ONLY where possible — every function without side-effects
 *    is marked with a @pure JSDoc tag and can be unit-tested without mocks.
 *
 * 2. WHAT SCALES, WHAT DOES NOT:
 *    ✓ calories  — scales with cooking multiplier (more oil = more kcal)
 *    ✓ fat       — scales with cooking multiplier (oil is fat)
 *    ✗ protein   — intrinsic molecular property. Extra oil adds no protein.
 *    ✗ carbs     — intrinsic. Oil does not add carbohydrates.
 *    ✗ gl        — Glycemic Load is calculated from carbs × GI. Neither changes.
 *
 * 3. TIMEZONE: All date comparisons use Asia/Kolkata (IST). UTC is never used
 *    directly for date-keyed data to prevent midnight boundary bugs.
 *
 * 4. DENORMALIZATION: multiplier and is_home are stored on every LogEntry row.
 *    If the user updates their kitchen profile later, old logs are NOT affected.
 *    Historical accuracy is preserved at the row level.
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

import { localDb, type Food, type LogEntry, type KitchenProfile } from './localDb';

// ── TYPES ────────────────────────────────────────────────────────────────────

export type OilUsage = 'very_light' | 'moderate' | 'regular' | 'heavy';
export type WhoCooks = 'me' | 'maid' | 'mix';
export type CookStyle = 'health' | 'traditional' | 'mixed';

export interface KitchenAnswers {
  oil: OilUsage;
  cook: WhoCooks;
  style: CookStyle;
}

/** Returned by applyMultiplier() — ready to be written to daily_logs table */
export interface ComputedLogEntry {
  food_name: string;
  portion: string;
  qty: number;
  is_home: boolean;
  multiplier: number;
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
  gl: number;
  anomaly: boolean;
}

/** Returned by recalibrate() for side-effect handling in the call site */
export interface CalibrationResult {
  updated_profile: KitchenProfile;
  old_mult: number;
  new_mult: number;
  changed: boolean;
  skipped_reason?: 'insufficient_data' | 'manual_override' | 'no_change';
}

/** Payload passed to the toast notification system after calibration */
export interface CalibrationToastPayload {
  old_display: string;
  new_display: string;
  description: string;
}

// ── CONSTANTS ────────────────────────────────────────────────────────────────

/**
 * Oil multiplier map.
 * Reflects the caloric impact of different oil volumes in Indian home cooking.
 * "very_light" = <1 tsp oil per dish, "heavy" = ghee + oil combination.
 */
export const OIL_MULTIPLIERS: Record<OilUsage, number> = {
  very_light: 0.85,
  moderate:   1.00,
  regular:    1.15,
  heavy:      1.30,
} as const;

/**
 * Cook multiplier map.
 * "maid" household cooks in Mumbai typically use more oil than self-cooked meals.
 * "me" and "mix" are neutral — user intention mediates the oil amount.
 */
export const COOK_MULTIPLIERS: Record<WhoCooks, number> = {
  me:   1.00,
  maid: 1.05,
  mix:  1.00,
} as const;

/**
 * Cooking style multiplier map.
 * "traditional" Indian cooking = more ghee, tempering (tadka), richer gravies.
 * "health" = conscious reduction of added fats.
 */
export const STYLE_MULTIPLIERS: Record<CookStyle, number> = {
  health:      0.90,
  traditional: 1.10,
  mixed:       1.00,
} as const;

/** Restaurant multiplier is fixed — restaurants universally use more fat than home cooking */
export const RESTAURANT_MULTIPLIER = 1.30 as const;

/** Minimum home_mult allowed — prevents reducing calories by more than 30% */
export const MULT_MIN = 0.70 as const;

/** Maximum home_mult allowed — prevents more than 50% calorie inflation */
export const MULT_MAX = 1.50 as const;

/** Hard calorie cap per single log entry — above this is almost certainly a data error */
export const CALORIE_HARD_CAP = 4999 as const;

/** How many logs trigger a calibration cycle */
export const CALIBRATION_TRIGGER_INTERVAL = 10 as const;

/** Maximum number of recent home logs used in a single calibration pass */
export const CALIBRATION_WINDOW = 30 as const;

/** Minimum home logs required before calibration runs (avoids tiny sample skew) */
export const CALIBRATION_MIN_HOME_LOGS = 5 as const;

/** Maximum absolute change in home_mult from a single calibration cycle */
export const CALIBRATION_MAX_NUDGE = 0.05 as const;

/** Maximum total drift from initial_home_mult across all calibration cycles */
export const CALIBRATION_MAX_DRIFT = 0.30 as const;

// ── UTILITY ──────────────────────────────────────────────────────────────────

/**
 * Clamps a number between min and max (inclusive).
 * @pure
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Returns today's date string in IST (Asia/Kolkata) as "YYYY-MM-DD".
 * Uses Intl.DateTimeFormat to correctly handle midnight boundaries — avoids
 * the common bug where UTC midnight (18:30 IST) rolls the date to tomorrow.
 */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).format(new Date());
}

// ── STEP 3.1 — PROFILE MULTIPLIER CALCULATION ────────────────────────────────

/**
 * Builds an initial KitchenProfile from the user's 3 onboarding answers.
 *
 * Formula: raw_mult = oil_mult × cook_mult × style_mult
 * The product is clamped to [MULT_MIN, MULT_MAX] to prevent extreme values.
 *
 * initial_home_mult is stored immutably — the self-calibration engine uses it
 * as the anchor for its drift ceiling (never drift > ±0.30 from this value).
 *
 * @pure — no side effects, deterministic output for same inputs
 */
export function buildKitchenProfile(answers: KitchenAnswers): KitchenProfile {
  const oil_mult   = OIL_MULTIPLIERS[answers.oil];
  const cook_mult  = COOK_MULTIPLIERS[answers.cook];
  const style_mult = STYLE_MULTIPLIERS[answers.style];

  const raw_mult  = oil_mult * cook_mult * style_mult;
  const home_mult = clamp(parseFloat(raw_mult.toFixed(3)), MULT_MIN, MULT_MAX);

  return {
    home_mult,
    rest_mult:          RESTAURANT_MULTIPLIER,
    initial_home_mult:  home_mult,   // immutable anchor — never overwritten by calibration
    answers,
    calibration_count:  0,
    calibrated_at:      undefined,
    manual_override:    false,
  };
}

/**
 * Formats a multiplier number for display in the UI.
 * @pure
 * @example formatMultiplierForDisplay(1.15) → "1.15×"
 */
export function formatMultiplierForDisplay(mult: number): string {
  return `${mult.toFixed(2)}×`;
}

/**
 * Returns a human-readable description of what a multiplier value means
 * in terms of cooking richness. Used in Kitchen Profile settings screen.
 * @pure
 */
export function getMultiplierDescription(mult: number): string {
  if (mult < 0.90)              return 'Light cooking';
  if (mult >= 0.90 && mult <= 1.10) return 'Standard home cooking';
  if (mult > 1.10 && mult <= 1.30)  return 'Rich cooking';
  return 'Very rich cooking';
}

// ── STEP 3.2 — FOOD ENTRY MACRO MULTIPLIER CALCULATION ───────────────────────

/**
 * Applies the kitchen multiplier to a food entry and returns the final
 * computed values ready for insertion into daily_logs.
 *
 * SCALING RULES (see module header for rationale):
 *   cal  = food.calories × qty × mult   ← scales (oil adds kcal)
 *   fat  = food.fat      × qty × mult   ← scales (oil is fat)
 *   protein = food.protein × qty        ← does NOT scale
 *   carbs   = food.carbs   × qty        ← does NOT scale
 *   gl      = food.gl      × qty        ← does NOT scale
 *
 * SAFETY: if computed cal > 4999, it is capped and an anomaly flag is set.
 * The anomaly is also written to the events table for monitoring.
 *
 * @pure — side effect (logAnomalyEvent) is only triggered when anomaly=true
 *         and is an async fire-and-forget so the function signature stays sync.
 */
export function applyMultiplier(
  food: Food,
  qty: number,
  isHome: boolean,
  profile: KitchenProfile,
): ComputedLogEntry {
  const mult = isHome ? profile.home_mult : profile.rest_mult;

  const raw_cal = food.calories * qty * mult;
  const raw_fat = food.fat      * qty * mult;

  // Intrinsic macros — no multiplier applied
  const protein = parseFloat((food.protein * qty).toFixed(1));
  const carbs   = parseFloat((food.carbs   * qty).toFixed(1));
  const gl      = parseFloat((food.gl      * qty).toFixed(1));

  let cal     = Math.round(raw_cal);
  let fat     = parseFloat(raw_fat.toFixed(1));
  let anomaly = false;

  // Hard cap — above 4999 kcal is almost certainly wrong data
  if (cal > CALORIE_HARD_CAP) {
    logAnomalyEvent({
      food_name:  food.name,
      raw_cal,
      multiplier: mult,
      qty,
    });
    cal     = CALORIE_HARD_CAP;
    fat     = parseFloat((CALORIE_HARD_CAP * 0.35 / 9).toFixed(1)); // rough fat estimate at cap
    anomaly = true;
  }

  return {
    food_name:  food.name,
    portion:    food.portion,
    qty,
    is_home:    isHome,
    multiplier: mult,           // denormalized — historical entry integrity
    cal,
    protein,
    carbs,
    fat,
    gl,
    anomaly,
  };
}

/**
 * Writes a calorie anomaly event to the events table via Dexie sync queue.
 * Fire-and-forget — errors are silently caught to not block the log flow.
 *
 * In production this writes to the `events` Supabase table via the SyncManager.
 * Here we write to a local queue entry for the SyncManager to flush.
 */
function logAnomalyEvent(props: {
  food_name: string;
  raw_cal: number;
  multiplier: number;
  qty: number;
}): void {
  // Fire-and-forget — errors must not propagate up
  localDb.sync_queue
    .add({
      user_id:    '__current__',   // SyncManager replaces this with real userId on flush
      action:     'insert_energy', // reused as generic event channel — SyncManager routes by payload.event_name
      payload:    {
        event_name: 'calorie_anomaly',
        properties: props,
        created_at: new Date().toISOString(),
      },
      device_id:  'kie_internal',
      created_at: new Date().toISOString(),
      retry_count: 0,
        synced: 0 as const,
    })
    .catch(() => { /* silent — anomaly logging must never block the user */ });
}

// ── STEP 3.3 — SELF-CALIBRATION ENGINE ───────────────────────────────────────

/**
 * Returns true when a calibration cycle should run.
 *
 * Calibration runs on every 10th log entry — not more frequently to avoid
 * reacting to a single unusual meal.
 *
 * @pure
 */
export function shouldRecalibrate(
  profile: KitchenProfile,
  newLogCount: number,
): boolean {
  return (
    newLogCount > 0 &&
    newLogCount % CALIBRATION_TRIGGER_INTERVAL === 0
  );
}

/**
 * Runs a single calibration pass and returns the updated profile.
 *
 * ALGORITHM:
 *   1. Filter recentLogs to home-cooked only (is_home === true)
 *   2. Require at least CALIBRATION_MIN_HOME_LOGS home logs — skip otherwise
 *   3. Compare avg logged calories vs avg expected calories at mult=1.0
 *      ratio = avg_logged / avg_expected
 *   4. Compute dampened nudge: (ratio - 1.0) × 0.10
 *   5. Cap single-cycle nudge at ±CALIBRATION_MAX_NUDGE (0.05)
 *   6. Cap total drift from initial_home_mult at ±CALIBRATION_MAX_DRIFT (0.30)
 *   7. Clamp final value to [MULT_MIN, MULT_MAX]
 *
 * GUARD CONDITIONS (returns skipped result):
 *   - manual_override is true
 *   - fewer than CALIBRATION_MIN_HOME_LOGS home entries in window
 *   - computed new_mult is identical to current home_mult (no change needed)
 *
 * @pure — returns new profile object, does not mutate input
 */
export function recalibrate(
  profile: KitchenProfile,
  recentLogs: LogEntry[],
  masterFoodLookup: (foodName: string) => Food | undefined,
): CalibrationResult {
  // Guard 1: user has manually set their multiplier — respect that
  if (profile.manual_override) {
    return {
      updated_profile: profile,
      old_mult: profile.home_mult,
      new_mult: profile.home_mult,
      changed:  false,
      skipped_reason: 'manual_override',
    };
  }

  // Filter to home-cooked logs only — restaurant logs use a fixed mult, irrelevant here
  const homeLogs = recentLogs
    .filter(log => log.is_home)
    .slice(-CALIBRATION_WINDOW);  // take last N home logs

  // Guard 2: insufficient data
  if (homeLogs.length < CALIBRATION_MIN_HOME_LOGS) {
    return {
      updated_profile: profile,
      old_mult: profile.home_mult,
      new_mult: profile.home_mult,
      changed:  false,
      skipped_reason: 'insufficient_data',
    };
  }

  // Compute average logged calories vs expected at multiplier = 1.0
  let sum_logged   = 0;
  let sum_expected = 0;
  let valid_count  = 0;

  for (const log of homeLogs) {
    const masterFood = masterFoodLookup(log.food_name);
    if (!masterFood) continue;  // can't compute expected without master food

    // expected = what the DB says at mult=1.0 for this qty
    const expected_cal = masterFood.calories * log.qty;
    // logged = what was actually stored (already multiplied)
    const logged_cal   = log.cal;

    sum_logged   += logged_cal;
    sum_expected += expected_cal;
    valid_count  += 1;
  }

  // Guard: no matchable master foods found
  if (valid_count < CALIBRATION_MIN_HOME_LOGS || sum_expected === 0) {
    return {
      updated_profile: profile,
      old_mult: profile.home_mult,
      new_mult: profile.home_mult,
      changed:  false,
      skipped_reason: 'insufficient_data',
    };
  }

  const avg_logged   = sum_logged   / valid_count;
  const avg_expected = sum_expected / valid_count;

  // ratio: how much higher/lower was actual vs expected at mult=1.0
  const ratio = avg_logged / avg_expected;

  // Dampened nudge — only move 10% of the observed gap per cycle
  // This prevents overreacting to a few unusual meals
  const raw_nudge    = (ratio - 1.0) * 0.10;

  // Cap the single-cycle nudge
  const capped_nudge = clamp(raw_nudge, -CALIBRATION_MAX_NUDGE, CALIBRATION_MAX_NUDGE);

  const old_mult     = profile.home_mult;
  let   new_mult     = old_mult + capped_nudge;

  // Drift ceiling: never move more than ±0.30 from the immutable initial value
  const drift_floor  = profile.initial_home_mult - CALIBRATION_MAX_DRIFT;
  const drift_ceil   = profile.initial_home_mult + CALIBRATION_MAX_DRIFT;
  new_mult           = clamp(new_mult, drift_floor, drift_ceil);

  // Hard clamp to absolute bounds
  new_mult = clamp(parseFloat(new_mult.toFixed(3)), MULT_MIN, MULT_MAX);

  // Guard 3: no meaningful change
  if (Math.abs(new_mult - old_mult) < 0.001) {
    return {
      updated_profile: profile,
      old_mult,
      new_mult: old_mult,
      changed:  false,
      skipped_reason: 'no_change',
    };
  }

  const updated_profile: KitchenProfile = {
    ...profile,
    home_mult:         new_mult,
    calibration_count: profile.calibration_count + valid_count,
    calibrated_at:     new Date().toISOString(),
    // initial_home_mult is NEVER overwritten — immutable anchor
  };

  return {
    updated_profile,
    old_mult,
    new_mult,
    changed: true,
  };
}

/**
 * Commits a calibration result to both Supabase (via sync queue) and Dexie.
 * This is the ONLY function in this module with intentional side effects.
 *
 * Call this immediately after recalibrate() returns changed=true.
 * Also fires:
 *   - a calibration_run analytics event (via sync queue)
 *   - a toast notification payload (returned for the UI layer to consume)
 *
 * @sideEffects — writes to Dexie and sync_queue
 */
export async function commitCalibration(
  userId: string,
  result: CalibrationResult,
): Promise<CalibrationToastPayload | null> {
  if (!result.changed) return null;

  const { updated_profile, old_mult, new_mult } = result;

  // 1. Write updated profile to Dexie user_prefs
  await localDb.user_prefs.put({
    key:   'kitchen_profile',
    value: updated_profile,
  });

  // 2. Enqueue Supabase write (SyncManager flushes this when online)
  await localDb.sync_queue.add({
    user_id:    userId,
    action:     'update_kitchen_profile',
    payload:    updated_profile,
    device_id:  await getDeviceId(),
    created_at: new Date().toISOString(),
    retry_count: 0,
        synced: 0 as const,
  });

  // 3. Enqueue analytics event
  await localDb.sync_queue.add({
    user_id:    userId,
    action:     'insert_energy',    // generic event channel
    payload:    {
      event_name:  'calibration_run',
      properties: {
        old_mult,
        new_mult,
        logs_used:   updated_profile.calibration_count,
        calibrated_at: updated_profile.calibrated_at,
      },
      created_at: new Date().toISOString(),
    },
    device_id:  await getDeviceId(),
    created_at: new Date().toISOString(),
    retry_count: 0,
        synced: 0 as const,
  });

  // 4. Build toast payload for the UI layer
  return {
    old_display: formatMultiplierForDisplay(old_mult),
    new_display: formatMultiplierForDisplay(new_mult),
    description: getMultiplierDescription(new_mult),
  };
}

/**
 * Resets kitchen profile home_mult back to the immutable initial value
 * from the user's setup answers. Zeroes calibration state.
 *
 * Called from Settings → "Reset Kitchen Profile".
 * @sideEffects — writes to Dexie and sync_queue
 */
export async function resetCalibration(
  userId: string,
  profile: KitchenProfile,
): Promise<KitchenProfile> {
  const reset_profile: KitchenProfile = {
    ...profile,
    home_mult:         profile.initial_home_mult,
    calibration_count: 0,
    calibrated_at:     undefined,
    manual_override:   false,
  };

  await localDb.user_prefs.put({
    key:   'kitchen_profile',
    value: reset_profile,
  });

  await localDb.sync_queue.add({
    user_id:    userId,
    action:     'update_kitchen_profile',
    payload:    reset_profile,
    device_id:  await getDeviceId(),
    created_at: new Date().toISOString(),
    retry_count: 0,
        synced: 0 as const,
  });

  return reset_profile;
}

// ── INTERNAL HELPERS ──────────────────────────────────────────────────────────

/**
 * Returns a stable device identifier. Generated once and stored in user_prefs.
 * Used to attribute sync queue entries to the originating device.
 */
async function getDeviceId(): Promise<string> {
  const stored = await localDb.user_prefs.get('device_id');
  if (stored?.value) return stored.value as string;

  const id = crypto.randomUUID();
  await localDb.user_prefs.put({ key: 'device_id', value: id });
  return id;
}
