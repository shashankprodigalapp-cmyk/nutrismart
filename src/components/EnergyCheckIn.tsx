/**
 * EnergyCheckIn.tsx — Post-meal energy observation capture
 *
 * TIMING MODEL:
 *   The energy check-in is scheduled to appear 60 minutes after the meal is logged.
 *   This matches the minimum bound of analyze-energy.ts's correlation window (60–90 min).
 *   Showing it too early (immediately after eating) would place the energy_log.created_at
 *   outside the correlation window and produce zero correlations for that observation.
 *
 *   scheduled_at  = time the meal was logged (set once, immutable)
 *   show_after    = scheduled_at + 60 minutes
 *   created_at    = time the user taps the rating button (actual observation time)
 *
 * MULTIPLE MEALS:
 *   Each meal gets its own pending entry stored under a per-meal Dexie key:
 *     `energy_checkin_${date}_${meal}`
 *   This allows lunch (13:00) and snack (15:00) to coexist as separate pending
 *   check-ins without one overwriting the other.
 *   At any moment, the component shows the OLDEST due check-in first (FIFO).
 *
 * STALENESS:
 *   A check-in is considered stale if show_after was more than 4 hours ago.
 *   Stale check-ins are silently expired — recording energy at 21:00 for a
 *   13:00 meal would produce a created_at that is 8 hours outside the 60–90 min
 *   window, making it worthless to analyze-energy.ts (priorMeal array is empty).
 *
 * APP RESUME:
 *   Because the component polls Dexie on mount and on a 30s interval, reopening
 *   the app 2 hours after a meal will immediately find the due check-in and show it.
 *   No push notification required for the basic flow.
 *
 * TIMESTAMP INTEGRITY (critical):
 *   energy_logs.created_at = new Date().toISOString() at the moment of the tap.
 *   Never set to scheduled_at or show_after.
 *   analyze-energy.ts uses created_at to locate food logs 60–90 minutes prior.
 *
 * DIAGRAM:
 *   13:00  meal logged → pending entry written, show_after = 14:00
 *   13:01  user reopens log tab → NOT visible (now < show_after)
 *   14:05  user opens app → visible (now ≥ show_after, within stale window)
 *   14:15  user taps 😐 → energy_logs.created_at = 14:15
 *          analyze-energy.ts: eTime=14:15, window = [13:05, 13:15] → finds lunch foods ✓
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { localDb, type EnergyLog } from '../lib/localDb';
import { getSyncManager } from '../lib/SyncManager';
import { useAuth } from '../context/AuthContext';
import { todayIST } from '../lib/kitchenIntelligence';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

/** Minimum minutes after logging before the check-in appears. Matches WINDOW_MIN_MINUTES in analyze-energy.ts. */
const SHOW_AFTER_MINUTES = 60;

/** A check-in older than this (since show_after) is expired — too far outside the 60–90 min window to be useful. */
const STALE_AFTER_MINUTES = 4 * 60; // 4 hours

const POLL_INTERVAL_MS = 30_000; // 30 seconds

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  snack:     'Snack',
  dinner:    'Dinner',
};

/** Dexie key prefix — one entry per meal per day. */
const KEY_PREFIX = 'energy_checkin_';

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface PendingCheckIn {
  /** Dexie key — `energy_checkin_${date}_${meal}` */
  key:          string;
  meal:         string;
  meal_label:   string;
  /** ISO — when the first food of this meal was logged. Immutable after creation. */
  scheduled_at: string;
  /** ISO — show_after = scheduled_at + SHOW_AFTER_MINUTES. Pre-computed at creation. */
  show_after:   string;
  total_gl:     number;
  total_cal:    number;
  food_names:   string[];
}

// ── RATING OPTIONS ────────────────────────────────────────────────────────────

const RATINGS: Array<{
  emoji: string;
  label: string;
  level: 'low' | 'steady' | 'high';
}> = [
  { emoji: '⚡', label: 'Great',    level: 'high'   },
  { emoji: '🙂', label: 'Good',     level: 'high'   },
  { emoji: '😐', label: 'Normal',   level: 'steady' },
  { emoji: '😴', label: 'Low',      level: 'low'    },
  { emoji: '🥱', label: 'Very low', level: 'low'    },
];

// ── HELPERS ───────────────────────────────────────────────────────────────────

function makePendingKey(date: string, meal: string): string {
  return `${KEY_PREFIX}${date}_${meal}`;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * scheduleEnergyCheckIn — called by LogTab after each food entry is confirmed.
 *
 * • First call for a meal: creates a new pending entry with show_after = now + 60 min.
 * • Subsequent calls for the same meal: merges GL/cal/food_names. show_after unchanged.
 * • Different meal (e.g. snack after lunch): creates a second independent entry.
 */
export async function scheduleEnergyCheckIn(params: {
  meal:      string;
  total_gl:  number;
  total_cal: number;
  food_name: string;
}): Promise<void> {
  const today = todayIST();
  const key   = makePendingKey(today, params.meal);

  const existing = await localDb.user_prefs.get(key);
  const prev = existing?.value as PendingCheckIn | undefined;

  const now = new Date().toISOString();

  const updated: PendingCheckIn = prev
    ? {
        // Merge into existing entry — do NOT reset show_after
        ...prev,
        total_gl:   prev.total_gl  + params.total_gl,
        total_cal:  prev.total_cal + params.total_cal,
        food_names: [...new Set([...prev.food_names, params.food_name])],
      }
    : {
        // New entry
        key,
        meal:         params.meal,
        meal_label:   MEAL_LABELS[params.meal] ?? params.meal,
        scheduled_at: now,
        show_after:   addMinutes(now, SHOW_AFTER_MINUTES),
        total_gl:     params.total_gl,
        total_cal:    params.total_cal,
        food_names:   [params.food_name],
      };

  await localDb.user_prefs.put({ key, value: updated });
}

// ── COMPONENT ─────────────────────────────────────────────────────────────────

export function EnergyCheckIn() {
  const { user } = useAuth();
  const [current, setCurrent] = useState<PendingCheckIn | null>(null);
  const [saving,  setSaving]  = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Find the oldest DUE check-in ──────────────────────────────────────────
  const findDueCheckIn = useCallback(async (): Promise<PendingCheckIn | null> => {
    const today = todayIST();

    // Collect all pending keys for today
    const allPrefs = await localDb.user_prefs
      .where('key')
      .startsWith(KEY_PREFIX)
      .toArray();

    const now = Date.now();
    const due: PendingCheckIn[] = [];
    const toExpire: string[] = [];

    for (const pref of allPrefs) {
      const p = pref.value as PendingCheckIn;

      // Drop entries from previous IST days
      if (!p.key.startsWith(`${KEY_PREFIX}${today}_`)) {
        toExpire.push(pref.key);
        continue;
      }

      const showAfterMs = new Date(p.show_after).getTime();
      const staleMs     = showAfterMs + STALE_AFTER_MINUTES * 60_000;

      if (now >= staleMs) {
        // Too old — outside useful correlation window — silently expire
        toExpire.push(pref.key);
        continue;
      }

      if (now >= showAfterMs) {
        // Due: show_after has passed and not yet stale
        due.push(p);
      }
      // else: not yet due — leave in Dexie, poll again later
    }

    // Clean up expired entries
    if (toExpire.length) {
      await Promise.all(toExpire.map(k => localDb.user_prefs.delete(k)));
    }

    if (!due.length) return null;

    // Show the OLDEST due check-in first (by scheduled_at)
    due.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return due[0];
  }, []);

  // ── Poll loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    async function poll() {
      const due = await findDueCheckIn();
      // Only update state if the due check-in changed (avoids flicker)
      setCurrent(prev => {
        if (!due && !prev) return null;
        if (!due) return null;
        if (prev?.key === due.key) return prev; // same check-in, no rerender
        return due;
      });
    }

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, findDueCheckIn]);

  // ── Dismiss — writes a skipped=TRUE energy_log so the server knows ──────
  // This is the critical change for Phase 2B.1:
  // Without this write, the server (energy-checkin-cron) cannot distinguish
  // "skipped" from "still pending" and will send a push notification.
  // With this write, the cron filters WHERE NOT skipped and correctly omits
  // skipped meals.
  //
  // The row is written with the CURRENT timestamp (not scheduled_at) so
  // analyze-energy.ts can correctly identify that no meaningful energy data
  // exists for this observation slot (skipped rows are filtered out).
  //
  // level is set to 'steady' as a placeholder — analyze-energy.ts filters
  // WHERE NOT skipped, so this value is never used in correlation math.
  const handleDismiss = useCallback(async () => {
    if (!current) return;

    try {
      const now   = new Date().toISOString();
      const today = todayIST();

      // Only write to server if user is authenticated (they usually are,
      // but guard for edge case of dismissing before auth resolves)
      if (user) {
        const skipLog: EnergyLog = {
          id:          crypto.randomUUID(),
          user_id:     user.id,
          log_date:    today,
          log_time:    now,
          level:       'steady',   // placeholder — filtered out by analyze-energy.ts (skipped=true)
          meal_before: current.meal,
          total_gl:    current.total_gl,
          total_cal:   current.total_cal,
          skipped:     true,       // ← tells the server this was skipped
          created_at:  now,
        };

        // Write to Dexie (offline-safe)
        await localDb.energy_logs.put(skipLog);

        // Enqueue for Supabase sync — cron will see skipped=TRUE and stop notifying
        const sm = getSyncManager();
        await sm.enqueue('insert_energy', skipLog);
      }
    } catch {
      // Non-fatal — the worst outcome is one extra push notification
    }

    // Always clear the pending check-in regardless of whether the write succeeded
    await localDb.user_prefs.delete(current.key);
    setCurrent(null);
  }, [current, user]);

  // ── Rate — writes energy log with CURRENT timestamp ───────────────────────
  const handleRate = useCallback(async (rating: typeof RATINGS[0]) => {
    if (!user || !current || saving) return;
    setSaving(true);
    try {
      // CRITICAL: created_at = exact moment the user taps the button.
      // This is what analyze-energy.ts uses for its 60–90 min window calculation.
      // It must NOT be set to scheduled_at or show_after.
      const now   = new Date().toISOString();
      const today = todayIST();

      const log: EnergyLog = {
        id:          crypto.randomUUID(),
        user_id:     user.id,
        log_date:    today,
        log_time:    now,
        level:       rating.level,
        meal_before: current.meal,
        total_gl:    current.total_gl,
        total_cal:   current.total_cal,
        created_at:  now,   // ← actual observation time, never scheduled_at
      };

      await localDb.energy_logs.put(log);
      const sm = getSyncManager();
      await sm.enqueue('insert_energy', log);

      await localDb.user_prefs.delete(current.key);
      setCurrent(null);
    } catch {
      // Non-fatal — poll will resurface this check-in on next cycle
    } finally {
      setSaving(false);
    }
  }, [user, current, saving]);

  if (!current) return null;

  // Time-since display for context: "~75 min after lunch"
  const minutesAgo = Math.round(minutesSince(current.scheduled_at));
  const timeLabel  = minutesAgo < 60
    ? `${minutesAgo} min ago`
    : `~${Math.round(minutesAgo / 10) * 10} min ago`;

  const foodDisplay = current.food_names.slice(0, 2).join(', ')
    + (current.food_names.length > 2 ? ` +${current.food_names.length - 2}` : '');

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={handleDismiss} aria-hidden="true" />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 inset-x-0 z-50 bg-[#1C1C1E] rounded-t-3xl px-5 pt-3 pb-10">
        <div className="w-9 h-1 bg-[#3C3C3E] rounded-full mx-auto mb-4" />

        <div className="mb-4">
          <h2 className="font-['Playfair_Display'] text-[18px] font-black text-[#F5F5F5] leading-tight">
            How's your energy?
          </h2>
          <p className="text-[11px] text-[#636366] mt-1">
            After {current.meal_label.toLowerCase()} · {timeLabel}
            {foodDisplay ? ` · ${foodDisplay}` : ''}
          </p>
        </div>

        <div className="flex gap-2 mb-4">
          {RATINGS.map(rating => (
            <button
              key={rating.label}
              onClick={() => handleRate(rating)}
              disabled={saving}
              className="flex-1 flex flex-col items-center gap-1.5 bg-[#242426] border border-white/[0.07] rounded-2xl py-3 active:scale-[0.94] transition-transform disabled:opacity-40"
            >
              <span className="text-[22px] leading-none">{rating.emoji}</span>
              <span className="text-[9px] font-semibold text-[#A1A1A1] text-center leading-tight">
                {rating.label}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={handleDismiss}
          className="w-full py-3 text-[13px] text-[#636366] font-medium"
        >
          Skip for now
        </button>
      </div>
    </>
  );
}

export default EnergyCheckIn;
