-- =============================================================================
-- NutriSmart: 010_phase1_fixes.sql
-- Phase 1 — Fix existing blockers (audit findings)
-- Run after 009_community_gamification.sql
--
-- Changes (all backward-compatible, no data destroyed):
--   1. push_subscriptions: add 'auth' GENERATED column so cron queries work
--      (schema has auth_key, cron selects 'auth' — generated alias bridges gap)
--   2. streak_data: RLS policy already exists in 002 — verified, no change needed
--   3. daily_logs: add food_source column (DEFAULT 'master', nullable history safe)
--   4. events: composite index for retention_health_check RPC performance
-- =============================================================================

-- ── 1. PUSH SUBSCRIPTIONS: generated 'auth' alias ────────────────────────────
-- The schema column is named auth_key (migration 001).
-- cron-morning-verdict.ts selects 'endpoint, p256dh, auth' — this was fixed
-- in code (010 code fix), but adding a generated column provides belt-and-
-- suspenders compatibility and allows future code to use either name.
--
-- NOTE: Code fix (cron-morning-verdict.ts) already changes the SELECT to
-- 'auth_key'. This generated column is additive insurance for any other
-- code paths that may use 'auth' as the column name.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'push_subscriptions'
      AND column_name  = 'auth'
  ) THEN
    ALTER TABLE public.push_subscriptions
      ADD COLUMN auth TEXT GENERATED ALWAYS AS (auth_key) STORED;
  END IF;
END $$;

-- ── 2. STREAK_DATA: RLS policy verification ───────────────────────────────────
-- 002_rls_policies.sql already defines "streak_data_all_own" policy.
-- Verified in audit: the policy IS present in that migration.
-- No change needed here — this comment serves as the audit record.
--
-- If running on a database where 002 was not applied cleanly, uncomment:
-- DROP POLICY IF EXISTS "streak_data_all_own" ON public.streak_data;
-- CREATE POLICY "streak_data_all_own"
--   ON public.streak_data FOR ALL TO authenticated
--   USING  ((SELECT auth.uid()) = user_id)
--   WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── 3. DAILY_LOGS: food_source column ────────────────────────────────────────
-- Identifies whether food_id references master_foods or user_custom_foods.
-- Required by Smart Quick-Log to reconstruct the correct Food object for
-- re-logging. Also needed for Kitchen Intelligence calibration lookup.
--
-- DEFAULT 'master' is the safest assumption for historical rows:
-- most logged foods are (or will be, once master_foods is seeded) master foods.
-- 'custom' is set by the UI when the user logs from AI search results.
-- 'ai' is set when logging from photo recognition.

ALTER TABLE public.daily_logs
  ADD COLUMN IF NOT EXISTS food_source TEXT DEFAULT 'master'
  CHECK (food_source IN ('master', 'custom', 'ai'));

-- Index to support My Usuals frequency queries (upcoming Phase 2 feature)
-- Using CONCURRENTLY would need to be run outside a transaction in Supabase SQL editor
CREATE INDEX IF NOT EXISTS idx_daily_logs_user_food_name
  ON public.daily_logs(user_id, food_name);

-- ── 4. EVENTS: composite index for retention_health_check ────────────────────
-- retention_health_check() RPC (008 migration) cross-joins events by both
-- user_id and event_name. The existing two single-column indexes require
-- two index scans and a merge. A composite speeds this to a single scan.
-- NOT CONCURRENTLY because we are inside a migration — safe to build with lock
-- on a small table; use CONCURRENTLY manually for large production deployments.

CREATE INDEX IF NOT EXISTS idx_events_user_name_date
  ON public.events(user_id, event_name, created_at DESC);

-- ── 5. energy_logs: index on created_at (what analyze-energy.ts actually uses)
-- analyze-energy.ts queries energy_logs ordered by created_at, not log_date.
-- The existing index is on (user_id, log_date DESC). This adds the missing one.
CREATE INDEX IF NOT EXISTS idx_energy_logs_user_created
  ON public.energy_logs(user_id, created_at DESC);

-- ── VERIFICATION QUERIES (run manually to confirm) ───────────────────────────
/*
-- 1. Confirm 'auth' generated column exists on push_subscriptions:
SELECT column_name, generation_expression
FROM information_schema.columns
WHERE table_name = 'push_subscriptions' AND column_name IN ('auth_key', 'auth');

-- 2. Confirm food_source column on daily_logs:
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'daily_logs' AND column_name = 'food_source';

-- 3. Confirm new indexes exist:
SELECT indexname FROM pg_indexes
WHERE tablename IN ('daily_logs', 'events', 'energy_logs')
  AND indexname IN (
    'idx_daily_logs_user_food_name',
    'idx_events_user_name_date',
    'idx_energy_logs_user_created'
  );

-- 4. Confirm streak_data has a policy (from 002):
SELECT policyname FROM pg_policies
WHERE tablename = 'streak_data';

-- 5. Test user isolation on push_subscriptions (run as authenticated user):
-- SELECT * FROM push_subscriptions; -- should only return own rows
*/
