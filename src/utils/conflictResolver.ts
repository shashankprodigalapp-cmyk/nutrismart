/**
 * conflictResolver.ts — NutriSmart Deterministic Conflict Resolution
 * Module 2, Step 2.3
 *
 * RESOLUTION RULES (in priority order):
 *
 * 1. PAST DATES → Server wins.
 *    Historical logs are server-authoritative. A past-date edit on the
 *    client cannot override the server. Rationale: streak and calibration
 *    calculations run server-side against committed history.
 *
 * 2. TODAY → Local client wins.
 *    The user is actively logging. Mid-session server data (from another
 *    device) is merged in by UUID deduplication, but local-only entries
 *    (not yet in server) are preserved as-is.
 *
 * 3. SAME UUID → Server version preferred for past dates, local for today.
 *
 * 4. WATER → max(local, server). Both devices adding water is additive intent.
 *    Exception: delta > 4 glasses triggers a reconciliation toast.
 *
 * 5. STREAK → Always server-authoritative (never recomputed on client).
 *
 * MEAL MOVE VALIDATION:
 *   Users can reclassify a log entry to a different meal (e.g. move a food
 *   from Snack to Dinner). This is a safe mutation because the food_id, qty,
 *   and all macros remain unchanged — only the `meal` field updates.
 *
 * ALL FUNCTIONS ARE PURE — no Dexie or Supabase calls inside this module.
 * Side effects are handled by SyncManager at the call site.
 */

import type { LogEntry, WaterLog, StreakData } from '../lib/localDb';

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface MergeResult<T> {
  merged:   T[];
  added:    T[];    // present only in one source, now included
  skipped:  T[];    // duplicates that were dropped
}

export interface WaterMergeResult {
  glasses:            number;
  needsConfirmation:  boolean;  // true if delta > 4 — show reconciliation toast
  delta:              number;
}

export interface MealMoveValidation {
  valid:   boolean;
  reason?: string;
}

// ── DAILY LOGS CONFLICT RESOLUTION ───────────────────────────────────────────

/**
 * Merges local and server log entries for a given date.
 *
 * @param local   - LogEntry[] from Dexie for this date
 * @param server  - LogEntry[] from Supabase for this date
 * @param date    - "YYYY-MM-DD" in IST — used to determine today vs past
 * @param todayIST - today's date in IST — from todayIST() utility
 */
export function mergeDailyLogs(
  local:    LogEntry[],
  server:   LogEntry[],
  date:     string,
  todayIST: string,
): MergeResult<LogEntry> {
  const isToday = date === todayIST;
  const isPast  = date < todayIST;

  // Index server entries by UUID
  const serverMap = new Map<string, LogEntry>(
    server.map(entry => [entry.id, entry])
  );
  // Index local entries by UUID
  const localMap = new Map<string, LogEntry>(
    local.map(entry => [entry.id, entry])
  );

  const merged:  LogEntry[] = [];
  const added:   LogEntry[] = [];
  const skipped: LogEntry[] = [];

  // Collect all unique UUIDs from both sources
  const allIds = new Set([...serverMap.keys(), ...localMap.keys()]);

  for (const id of allIds) {
    const serverEntry = serverMap.get(id);
    const localEntry  = localMap.get(id);

    if (serverEntry && localEntry) {
      // Same UUID exists in both
      if (isPast) {
        // Past date: server wins
        merged.push(serverEntry);
        skipped.push(localEntry);
      } else {
        // Today: local wins (user is actively editing)
        merged.push(localEntry);
        // Server version is kept as reference but not used in final result
      }
    } else if (serverEntry && !localEntry) {
      // Only on server (logged from another device)
      merged.push(serverEntry);
      added.push(serverEntry);
    } else if (localEntry && !serverEntry) {
      // Only local (pending sync or recently deleted on server)
      if (isPast) {
        // Past date: entry that isn't on server should not be here
        // (could be orphaned by a failed sync — skip it)
        skipped.push(localEntry);
      } else {
        // Today: preserve local-only entry (not yet synced)
        merged.push(localEntry);
      }
    }
  }

  // Sort merged by created_at ascending (chronological display order)
  merged.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return { merged, added, skipped };
}

/**
 * Detects likely duplicate entries created by double-logging on two devices.
 * Two entries are "suspect duplicates" if they share:
 *   - same log_date and meal
 *   - same food_name
 *   - same qty (within 0.01)
 *   - created_at within 5 minutes of each other
 *   - different UUIDs (same UUID would be caught by mergeDailyLogs)
 */
export function detectSuspectDuplicates(entries: LogEntry[]): Array<[LogEntry, LogEntry]> {
  const suspects: Array<[LogEntry, LogEntry]> = [];
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      if (a.id === b.id) continue;                             // same UUID — handled elsewhere
      if (a.food_name !== b.food_name) continue;
      if (a.meal !== b.meal) continue;
      if (Math.abs(a.qty - b.qty) > 0.01) continue;
      if (a.log_date !== b.log_date) continue;

      const timeDiff = Math.abs(
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      if (timeDiff <= FIVE_MINUTES_MS) {
        suspects.push([a, b]);
      }
    }
  }

  return suspects;
}

// ── WATER LOG CONFLICT RESOLUTION ─────────────────────────────────────────────

/**
 * Merges local and server water glass counts.
 * Takes the maximum — two devices adding water is additive intent.
 * If delta > 4, sets needsConfirmation=true for a reconciliation toast.
 */
export function mergeWaterLogs(
  local:  WaterLog | null,
  server: WaterLog | null,
): WaterMergeResult {
  const localGlasses  = local?.glasses  ?? 0;
  const serverGlasses = server?.glasses ?? 0;

  const glasses = Math.max(localGlasses, serverGlasses);
  const delta   = Math.abs(localGlasses - serverGlasses);

  return {
    glasses,
    needsConfirmation: delta > 4,
    delta,
  };
}

// ── STREAK CONFLICT RESOLUTION ────────────────────────────────────────────────

/**
 * Streak is always server-authoritative.
 * Returns the server value unchanged, regardless of local state.
 * Called when pulling data from Supabase to ensure local streak never diverges.
 */
export function resolveStreak(
  _local: StreakData | null,
  server: StreakData,
): StreakData {
  return server;
}

// ── MEAL MOVE VALIDATION ──────────────────────────────────────────────────────

const VALID_MEALS = new Set(['breakfast', 'lunch', 'snack', 'dinner']);

/**
 * Validates whether a log entry can be safely moved to a different meal slot.
 *
 * Rules:
 * 1. Target meal must be a valid meal type.
 * 2. The entry must not already be at the target meal (no-op guard).
 * 3. The entry must belong to today — past meal moves are disallowed
 *    (would require server-side recalculation of daily totals).
 * 4. All macros and food_id remain unchanged — only `meal` updates.
 */
export function validateMealMove(
  entry:      LogEntry,
  targetMeal: string,
  todayIST:   string,
): MealMoveValidation {
  if (!VALID_MEALS.has(targetMeal)) {
    return {
      valid:  false,
      reason: `Invalid meal type: ${targetMeal}. Must be breakfast, lunch, snack, or dinner.`,
    };
  }

  if (entry.meal === targetMeal) {
    return {
      valid:  false,
      reason: `Entry is already in ${targetMeal}.`,
    };
  }

  if (entry.log_date < todayIST) {
    return {
      valid:  false,
      reason: 'Past meal entries cannot be moved to a different meal type.',
    };
  }

  return { valid: true };
}

/**
 * Applies a meal move to an entry, returning an updated LogEntry.
 * The caller must validate with validateMealMove() first.
 * Pure function — returns new object, does not mutate input.
 */
export function applyMealMove(
  entry:      LogEntry,
  targetMeal: LogEntry['meal'],
): LogEntry {
  return {
    ...entry,
    meal:       targetMeal,
    synced_at:  undefined,  // mark as dirty — needs re-sync
  };
}

// ── CLONE BASELINE INDICES ────────────────────────────────────────────────────

/**
 * Creates a new LogEntry derived from a historical entry for a new date.
 * Used when a user "repeats" a previous meal — clones the food and macros
 * but assigns a new UUID and today's date.
 *
 * The cloned entry inherits the original multiplier (kitchen profile at
 * time of original log) rather than today's possibly different profile.
 * This is intentional — re-logging gets current multiplier via the UI
 * add-food flow, not from the clone operation.
 */
export function cloneLogEntry(
  source:   LogEntry,
  newDate:  string,
  newMeal:  LogEntry['meal'],
  newId:    string,   // caller supplies UUID to avoid crypto dep
): LogEntry {
  return {
    ...source,
    id:         newId,
    log_date:   newDate,
    meal:       newMeal,
    synced_at:  undefined,
    created_at: new Date().toISOString(),
  };
}

// ── USER PREFS CONFLICT RESOLUTION ───────────────────────────────────────────

interface UserTargets {
  cal:    number;
  protein: number;
  gl:     number;
  fat:    number;
  water:  number;
  updated_at: string;
}

/**
 * Resolves conflicts between local and server user preference (targets).
 * Server wins if server updated_at is more recent.
 * Local wins otherwise — protects against stale pulls overwriting
 * in-session changes.
 *
 * NOTE: today_override (festival/event budget) is never compared here —
 * those are local-only and never pushed to the server.
 */
export function resolveUserTargets(
  local:  UserTargets | null,
  server: UserTargets | null,
): UserTargets | null {
  if (!local && !server) return null;
  if (!local)  return server;
  if (!server) return local;

  const localTime  = new Date(local.updated_at).getTime();
  const serverTime = new Date(server.updated_at).getTime();

  return serverTime > localTime ? server : local;
}
