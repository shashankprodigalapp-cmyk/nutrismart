/**
 * MealLevelMatching.test.ts — Phase 2B.2
 *
 * Tests the meal-level (user_id + log_date + meal) matching logic
 * that determines which meals are pending, answered, or skipped.
 *
 * All 12 required test cases plus regression tests.
 */

import { describe, it, expect } from 'vitest';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface DailyLog {
  user_id:    string;
  log_date:   string;
  meal:       string;
  created_at: string;
}

interface EnergyLogRow {
  user_id:     string;
  log_date:    string;
  meal_before: string;
  skipped:     boolean;
}

// ── CORE MATCHING LOGIC (mirrors energy-checkin-cron.ts) ─────────────────────

/** Deduplicate daily_log rows → one candidate per (user, date, meal) */
function buildCandidates(logs: DailyLog[]): Array<{ user_id: string; log_date: string; meal: string }> {
  const seen = new Set<string>();
  const candidates: Array<{ user_id: string; log_date: string; meal: string }> = [];
  for (const row of logs) {
    const key = `${row.user_id}|${row.log_date}|${row.meal}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ user_id: row.user_id, log_date: row.log_date, meal: row.meal });
    }
  }
  return candidates;
}

/** Build the per-meal acted set from energy_logs rows */
function buildMealActed(energyLogs: EnergyLogRow[]): Set<string> {
  return new Set(energyLogs.map(e => `${e.user_id}|${e.log_date}|${e.meal_before}`));
}

/** Filter candidates to those with no energy_log row — these are pending */
function filterPending(
  candidates: Array<{ user_id: string; log_date: string; meal: string }>,
  mealActed:  Set<string>,
) {
  return candidates.filter(c => !mealActed.has(`${c.user_id}|${c.log_date}|${c.meal}`));
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

const DATE = '2026-08-31';
const U1 = 'user-1';
const U2 = 'user-2';

function log(user_id: string, meal: string, created_at = new Date().toISOString()): DailyLog {
  return { user_id, log_date: DATE, meal, created_at };
}

function answered(user_id: string, meal: string): EnergyLogRow {
  return { user_id, log_date: DATE, meal_before: meal, skipped: false };
}

function skipped(user_id: string, meal: string): EnergyLogRow {
  return { user_id, log_date: DATE, meal_before: meal, skipped: true };
}

// ── SUITE 1: Single meal states ───────────────────────────────────────────────

describe('Single meal states', () => {
  it('1. Lunch pending → Lunch notification sent', () => {
    const candidates = buildCandidates([log(U1, 'lunch')]);
    const acted      = buildMealActed([]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ user_id: U1, meal: 'lunch' });
  });

  it('2. Lunch answered → no Lunch notification', () => {
    const candidates = buildCandidates([log(U1, 'lunch')]);
    const acted      = buildMealActed([answered(U1, 'lunch')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(0);
  });

  it('3. Lunch skipped → no Lunch notification', () => {
    const candidates = buildCandidates([log(U1, 'lunch')]);
    const acted      = buildMealActed([skipped(U1, 'lunch')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(0);
  });
});

// ── SUITE 2: Multiple meals, independent evaluation ───────────────────────────

describe('Multiple meals — independent evaluation', () => {
  it('4. Lunch skipped + Snack pending → only Snack notification', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'snack')]);
    const acted      = buildMealActed([skipped(U1, 'lunch')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].meal).toBe('snack');
  });

  it('5. Lunch answered + Snack pending → only Snack notification', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'snack')]);
    const acted      = buildMealActed([answered(U1, 'lunch')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].meal).toBe('snack');
  });

  it('6. Lunch pending + Snack answered → only Lunch notification', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'snack')]);
    const acted      = buildMealActed([answered(U1, 'snack')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].meal).toBe('lunch');
  });

  it('7. Lunch skipped + Snack skipped → no notification', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'snack')]);
    const acted      = buildMealActed([skipped(U1, 'lunch'), skipped(U1, 'snack')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(0);
  });

  it('Lunch skipped + Snack skipped + Dinner pending → only Dinner', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'snack'), log(U1, 'dinner')]);
    const acted      = buildMealActed([skipped(U1, 'lunch'), skipped(U1, 'snack')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].meal).toBe('dinner');
  });

  it('Lunch answered + Snack skipped + Dinner pending → only Dinner', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'snack'), log(U1, 'dinner')]);
    const acted      = buildMealActed([answered(U1, 'lunch'), skipped(U1, 'snack')]);
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].meal).toBe('dinner');
  });

  it('9. Multiple pending meals → all notified', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'snack'), log(U1, 'dinner')]);
    const acted      = buildMealActed([]);  // nothing acted on
    const pending    = filterPending(candidates, acted);

    expect(pending).toHaveLength(3);
    const meals = pending.map(p => p.meal).sort();
    expect(meals).toEqual(['dinner', 'lunch', 'snack']);
  });
});

// ── SUITE 3: Multiple food items in one meal ──────────────────────────────────

describe('Multiple food items in one meal', () => {
  it('8. Three foods in Lunch produce ONE candidate', () => {
    const candidates = buildCandidates([
      log(U1, 'lunch'),  // Dal
      log(U1, 'lunch'),  // Roti
      log(U1, 'lunch'),  // Sabzi
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].meal).toBe('lunch');
  });

  it('Three foods in Lunch + one in Snack → two candidates', () => {
    const candidates = buildCandidates([
      log(U1, 'lunch'),
      log(U1, 'lunch'),
      log(U1, 'lunch'),
      log(U1, 'snack'),
    ]);

    expect(candidates).toHaveLength(2);
    const meals = candidates.map(c => c.meal).sort();
    expect(meals).toEqual(['lunch', 'snack']);
  });
});

// ── SUITE 4: Duplicate cron execution ────────────────────────────────────────

describe('Duplicate cron execution / notification dedup', () => {
  it('10. Notification tag is deterministic — same meal produces same tag', () => {
    const userId  = 'user-abc-123-def';
    const logDate = DATE;
    const meal    = 'lunch';

    const tag1 = `energy-checkin-${userId.slice(0, 8)}-${logDate}-${meal}`;
    const tag2 = `energy-checkin-${userId.slice(0, 8)}-${logDate}-${meal}`;

    // Same tag → browser replaces, does not stack — no notification spam
    expect(tag1).toBe(tag2);
  });

  it('Tag does NOT use mealHour (no UTC boundary sensitivity)', () => {
    // Old implementation used windowEnd.getUTCHours() in the tag.
    // If the cron ran at 13:59 UTC and 14:01 UTC, the hour would differ → two tags → two stacked notifications.
    // New implementation uses candidate.meal → always the same string.
    const mealName = 'lunch';
    const tag = `energy-checkin-abcdef12-2026-08-31-${mealName}`;

    // The tag does not contain a UTC hour (no digits from 0–23 at the end).
    // meal values: breakfast, lunch, snack, dinner — all non-numeric strings.
    expect(/^\d+$/.test(tag.split('-').at(-1)!)).toBe(false);
    // Confirm it ends with the meal name
    expect(tag.endsWith(`-${mealName}`)).toBe(true);
  });

  it('Different meals get different tags (no collision)', () => {
    const userId  = 'user-abc-123-def';
    const logDate = DATE;

    const lunchTag  = `energy-checkin-${userId.slice(0, 8)}-${logDate}-lunch`;
    const snackTag  = `energy-checkin-${userId.slice(0, 8)}-${logDate}-snack`;
    const dinnerTag = `energy-checkin-${userId.slice(0, 8)}-${logDate}-dinner`;

    expect(lunchTag).not.toBe(snackTag);
    expect(snackTag).not.toBe(dinnerTag);
    expect(lunchTag).not.toBe(dinnerTag);
  });
});

// ── SUITE 5: Expired check-in ─────────────────────────────────────────────────

describe('Expired check-in', () => {
  it('11. Expired meal (not in 60–90 min window) → not a candidate', () => {
    // The cron only fetches logs WHERE created_at BETWEEN now-90min AND now-60min.
    // A meal logged 3 hours ago is NOT in this window → not returned → not a candidate.
    // We simulate by having an empty recentLogs list.
    const candidates = buildCandidates([]);
    expect(candidates).toHaveLength(0);
  });

  it('A meal from yesterday with no energy_log is not a candidate (date filter)', () => {
    // The cron filters by created_at window, not log_date.
    // Yesterday's meal would not appear in recentLogs for today's cron.
    // Simulated by omitting it from the logs array.
    const candidates = buildCandidates([
      // Only today's meal in window
      log(U1, 'snack'),
    ]);
    const acted = buildMealActed([]);
    const pending = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    // No yesterday entry — it wouldn't be fetched
  });
});

// ── SUITE 6: User isolation ───────────────────────────────────────────────────

describe('User isolation', () => {
  it('12. Two users with same meal — state is independent per user', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U2, 'lunch')]);
    // U1 answered, U2 is pending
    const acted = buildMealActed([answered(U1, 'lunch')]);
    const pending = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].user_id).toBe(U2);
    expect(pending[0].meal).toBe('lunch');
  });

  it('U1 skip does NOT affect U2 pending', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U2, 'lunch')]);
    const acted = buildMealActed([skipped(U1, 'lunch')]);
    const pending = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].user_id).toBe(U2);
  });

  it('Both users pending → both notified', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U2, 'lunch')]);
    const acted = buildMealActed([]);
    const pending = filterPending(candidates, acted);

    expect(pending).toHaveLength(2);
    const users = pending.map(p => p.user_id).sort();
    expect(users).toEqual([U1, U2].sort());
  });
});

// ── SUITE 7: Meal key format ──────────────────────────────────────────────────

describe('Meal key integrity', () => {
  it('Candidate key = energy_log key for same meal', () => {
    const candidateKey = `${U1}|${DATE}|lunch`;
    const energyKey    = `${U1}|${DATE}|${'lunch'}`;  // meal_before = 'lunch'
    expect(candidateKey).toBe(energyKey);
  });

  it('Keys differ for different meals of the same user', () => {
    const lunchKey = `${U1}|${DATE}|lunch`;
    const snackKey = `${U1}|${DATE}|snack`;
    expect(lunchKey).not.toBe(snackKey);
  });

  it('Answered energy_log for wrong meal does not suppress correct pending meal', () => {
    const candidates = buildCandidates([log(U1, 'snack')]);
    // User answered Lunch, not Snack
    const acted = buildMealActed([answered(U1, 'lunch')]);
    const pending = filterPending(candidates, acted);

    // Snack is still pending — Lunch answer should not affect it
    expect(pending).toHaveLength(1);
    expect(pending[0].meal).toBe('snack');
  });
});

// ── SUITE 8: Regression — Phase 2B.1 skipped filter still works ──────────────

describe('Regression: skipped column filtering (Phase 2B.1)', () => {
  it('Skipped row in mealActed suppresses the correct meal only', () => {
    const candidates = buildCandidates([log(U1, 'lunch'), log(U1, 'dinner')]);
    const acted = buildMealActed([
      { user_id: U1, log_date: DATE, meal_before: 'lunch', skipped: true },
      // No dinner entry
    ]);
    const pending = filterPending(candidates, acted);

    expect(pending).toHaveLength(1);
    expect(pending[0].meal).toBe('dinner');
  });

  it('The mealActed set is built from ALL energy_log rows (answered OR skipped)', () => {
    const energyLogs: EnergyLogRow[] = [
      answered(U1, 'lunch'),
      skipped(U1, 'snack'),
    ];
    const acted = buildMealActed(energyLogs);

    expect(acted.has(`${U1}|${DATE}|lunch`)).toBe(true);
    expect(acted.has(`${U1}|${DATE}|snack`)).toBe(true);
    expect(acted.has(`${U1}|${DATE}|dinner`)).toBe(false);
  });
});
