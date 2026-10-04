-- =============================================================================
-- NutriSmart: 012_energy_logs_skipped.sql
-- Phase 2B.1 — Eliminate false push notifications for skipped energy check-ins
-- Run after 011_seed_master_foods.sql
--
-- ROOT CAUSE:
--   The energy_logs table only records answered check-ins (level IN ('low','steady','high')).
--   When a user taps "Skip", the local Dexie pending check-in is deleted but NO row
--   is written to energy_logs. The server-side cron (energy-checkin-cron.ts) infers
--   "pending" from "daily_logs 60–90 min ago + no energy_logs entry". It cannot
--   distinguish skipped from unanswered, so it sends a push for already-skipped meals.
--
-- SOLUTION:
--   Add `skipped BOOLEAN NOT NULL DEFAULT FALSE` to energy_logs.
--   When the user taps "Skip", we write a row with skipped = TRUE to Supabase.
--   The cron filters WHERE NOT skipped (or skipped IS FALSE).
--   analyze-energy.ts filters skipped rows out of its correlations.
--
-- WHY NOT A SEPARATE TABLE:
--   A separate table adds complexity and a new sync path. The skipped check-in
--   IS an energy observation event — just one the user declined to rate.
--   It belongs in energy_logs logically and temporally.
--
-- WHY NOT A NEW LEVEL VALUE ('skipped'):
--   Changing the CHECK constraint would require all consumers to handle a new value.
--   The skipped flag is orthogonal to the energy level — a boolean is the correct type.
--
-- BACKWARD COMPATIBILITY:
--   DEFAULT FALSE — all existing rows treated as answered (not skipped). Correct.
--   analyze-energy.ts currently reads all energy_logs rows; the new query filter
--   adds WHERE skipped IS NOT TRUE. For existing data (all skipped=FALSE), result
--   is identical. No existing data is affected.
--
-- RLS:
--   energy_logs has "energy_logs_all_own" policy (ALL for own rows, from 002).
--   The new column is covered by the existing policy — no change needed.
--
-- INDEX:
--   The cron queries: WHERE user_id IN (...) AND created_at >= ? AND NOT skipped
--   The existing (user_id, log_date DESC) index already covers user_id.
--   A partial index WHERE NOT skipped is added to accelerate the cron's filter.
-- =============================================================================

-- ── 1. Add skipped column ─────────────────────────────────────────────────────

ALTER TABLE public.energy_logs
  ADD COLUMN IF NOT EXISTS skipped BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Partial index for cron's "unanswered" filter ──────────────────────────
-- The cron queries: WHERE user_id IN (...) AND created_at >= ? AND NOT skipped
-- This index makes that filter efficient without touching the answered-rows path.

CREATE INDEX IF NOT EXISTS idx_energy_logs_unanswered
  ON public.energy_logs(user_id, created_at DESC)
  WHERE NOT skipped;

-- ── 3. No RLS change needed ───────────────────────────────────────────────────
-- energy_logs_all_own policy covers ALL operations for own rows.
-- The new column is included automatically.

-- ── VERIFICATION ─────────────────────────────────────────────────────────────
/*
-- Confirm column exists with correct default:
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'energy_logs' AND column_name = 'skipped';
-- Expected: column_name=skipped, data_type=boolean, column_default=false, is_nullable=NO

-- Confirm existing rows are NOT skipped (all default FALSE):
SELECT COUNT(*) FROM energy_logs WHERE skipped = TRUE;
-- Expected: 0

-- Confirm partial index exists:
SELECT indexname FROM pg_indexes
WHERE tablename = 'energy_logs' AND indexname = 'idx_energy_logs_unanswered';

-- Test that analyze-energy filter still works (existing rows unaffected):
SELECT COUNT(*) FROM energy_logs WHERE NOT skipped;
-- Should equal total row count (all existing rows have skipped=FALSE)
*/
