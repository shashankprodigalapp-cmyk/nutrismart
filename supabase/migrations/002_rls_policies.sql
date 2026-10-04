-- =============================================================================
-- NutriSmart: 002_rls_policies.sql
-- Module 1, Step 1.2 — Row Level Security Policies
-- Baseline timezone: Asia/Kolkata (IST)
--
-- SECURITY MODEL SUMMARY:
--   • Every table has RLS enabled — no table is accessible without a policy match
--   • master_foods: globally readable by authenticated users (public nutrition DB)
--   • User-owned tables: ALL operations gated on auth.uid() = user_id
--   • Server-only tables (subscriptions writes, webhooks, rate_limits):
--     client can SELECT own subscription; cannot INSERT/UPDATE/DELETE any of them
--   • processed_webhooks, rate_limits: zero client access — service role only
--
-- PERFORMANCE NOTE:
--   All policies use (SELECT auth.uid()) subquery form rather than bare auth.uid().
--   This caches the uid() call once per statement instead of re-evaluating per row,
--   which matters on tables with many rows (daily_logs, events, sync_queue).
--
-- IDEMPOTENCY: Every policy is CREATE OR REPLACE safe via DROP IF EXISTS + CREATE.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. HELPER: Enable RLS on all 16 tables
--    (safe to re-run — already-enabled tables are a no-op)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_foods        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_custom_foods   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_data         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_contributions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhooks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits         ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. USERS
--    Users manage their own profile row only.
--    Supabase Auth creates the row via trigger — we only need RLS for client
--    reads and updates (never direct inserts from client).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "users_select_own"     ON public.users;
DROP POLICY IF EXISTS "users_update_own"     ON public.users;
DROP POLICY IF EXISTS "users_delete_own"     ON public.users;

-- SELECT: user can only read their own row
CREATE POLICY "users_select_own"
  ON public.users
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

-- UPDATE: user can update their own row (targets, timezone, etc.)
CREATE POLICY "users_update_own"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING  ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- DELETE: user can delete their own account row
-- (CASCADE on auth.users means this wipes all child data)
CREATE POLICY "users_delete_own"
  ON public.users
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. MASTER_FOODS
--    Public read-only nutrition database. No client writes ever.
--    Writes happen only via admin RPCs using service role (see 003_admin_cms_rpc.sql).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "master_foods_read_all" ON public.master_foods;

CREATE POLICY "master_foods_read_all"
  ON public.master_foods
  FOR SELECT
  TO authenticated
  USING (true);

-- Explicit denial of writes (belt-and-suspenders — RLS blocks by default,
-- but this makes intent clear to any future engineer reading policies)
DROP POLICY IF EXISTS "master_foods_no_insert" ON public.master_foods;
DROP POLICY IF EXISTS "master_foods_no_update" ON public.master_foods;
DROP POLICY IF EXISTS "master_foods_no_delete" ON public.master_foods;

-- No INSERT, UPDATE, DELETE policies created = these operations are blocked for
-- all non-service-role clients automatically by RLS when no policy matches.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. USER_CUSTOM_FOODS
--    Each user's personal food additions from AI search results.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "custom_foods_all_own" ON public.user_custom_foods;

CREATE POLICY "custom_foods_all_own"
  ON public.user_custom_foods
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DAILY_LOGS
--    Core food logging table. Highest write volume in the system.
--    The (SELECT auth.uid()) form is especially important here for performance.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "daily_logs_all_own" ON public.daily_logs;

CREATE POLICY "daily_logs_all_own"
  ON public.daily_logs
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. KITCHEN_PROFILES
--    One row per user. Contains multipliers and calibration state.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "kitchen_profiles_all_own" ON public.kitchen_profiles;

CREATE POLICY "kitchen_profiles_all_own"
  ON public.kitchen_profiles
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ENERGY_LOGS
--    Post-meal mood/energy check-ins. Low volume per user.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "energy_logs_all_own" ON public.energy_logs;

CREATE POLICY "energy_logs_all_own"
  ON public.energy_logs
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. WATER_LOGS
--    One row per user per day (UPSERT pattern). Compound unique key enforced
--    by schema constraint; RLS is the authorization layer.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "water_logs_all_own" ON public.water_logs;

CREATE POLICY "water_logs_all_own"
  ON public.water_logs
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. MEAL_TEMPLATES
--    Saved quick-log combinations. All CRUD scoped to owner.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "meal_templates_all_own" ON public.meal_templates;

CREATE POLICY "meal_templates_all_own"
  ON public.meal_templates
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. STREAK_DATA
--    One row per user. user_id IS the primary key.
--    Streak is always server-authoritative — client reads only.
--    We allow INSERT/UPDATE here so the client can create the row on first use,
--    but streak calculations must be validated server-side via trigger.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "streak_data_all_own" ON public.streak_data;

CREATE POLICY "streak_data_all_own"
  ON public.streak_data
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. FOOD_CONTRIBUTIONS
--     Community food submissions pending admin review.
--     Users can INSERT their own and SELECT their own; cannot see others'.
--     Admins access via service role (bypasses RLS).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "food_contributions_insert_own"     ON public.food_contributions;
DROP POLICY IF EXISTS "food_contributions_select_own"     ON public.food_contributions;
DROP POLICY IF EXISTS "food_contributions_no_update_own"  ON public.food_contributions;

-- INSERT: authenticated users can submit contributions
CREATE POLICY "food_contributions_insert_own"
  ON public.food_contributions
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- SELECT: users can only see their own submissions (not others' pending work)
CREATE POLICY "food_contributions_select_own"
  ON public.food_contributions
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- UPDATE / DELETE: not allowed from client — admin only via service role

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. SUBSCRIPTIONS
--     CRITICAL SECURITY TABLE — client write access is completely blocked.
--     All INSERT/UPDATE/DELETE must go through Netlify Functions using the
--     service role key. This prevents clients from self-promoting their plan.
--
--     SELECT is allowed so the client can display plan status without an
--     extra API call.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "subscriptions_select_own"   ON public.subscriptions;

-- SELECT ONLY — no INSERT, UPDATE, or DELETE policy created
CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- SECURITY COMMENT: Absence of INSERT/UPDATE/DELETE policies means those
-- operations return "permission denied" for any authenticated client.
-- Razorpay webhook handler uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. PUSH_SUBSCRIPTIONS
--     VAPID endpoint registrations per device. Users manage their own devices.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "push_subscriptions_all_own" ON public.push_subscriptions;

CREATE POLICY "push_subscriptions_all_own"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. SYNC_QUEUE
--     Offline action queue. High write volume. Client owns its own queue rows.
--     SyncManager reads and marks synced_at; both require full access.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "sync_queue_all_own" ON public.sync_queue;

CREATE POLICY "sync_queue_all_own"
  ON public.sync_queue
  FOR ALL
  TO authenticated
  USING  ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. EVENTS (analytics)
--     Write-only from client perspective. Client fires events; never reads them.
--     Admin analytics are read via service role only (Netlify function).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "events_insert_own" ON public.events;

-- INSERT only — no SELECT policy created (clients cannot read analytics)
CREATE POLICY "events_insert_own"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. PROCESSED_WEBHOOKS
--     Idempotency registry for Razorpay webhooks. Zero client access.
--     Written exclusively by the razorpay-webhook Netlify function (service role).
-- ─────────────────────────────────────────────────────────────────────────────

-- No policies created = complete client lockout.
-- Service role key bypasses RLS for all webhook handler writes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. RATE_LIMITS
--     AI API rate limit counters. Zero client access — service role only.
--     The Netlify function proxy reads and increments these counters.
-- ─────────────────────────────────────────────────────────────────────────────

-- No policies created = complete client lockout.

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (run these manually to confirm policies are correct)
-- ─────────────────────────────────────────────────────────────────────────────

/*
-- 1. List all RLS-enabled tables:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 2. List all active policies:
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. Confirm subscriptions has no write policies (should return 0 rows):
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'subscriptions'
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE');

-- 4. Confirm processed_webhooks has no policies (should return 0 rows):
SELECT policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'processed_webhooks';

-- 5. Cross-user isolation test (run as User A, expect 0 rows):
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub": "user-b-uuid"}';
-- SELECT * FROM daily_logs WHERE user_id = 'user-a-uuid';
*/
