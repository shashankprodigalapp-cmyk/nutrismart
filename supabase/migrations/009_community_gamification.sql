-- =============================================================================
-- NutriSmart: 009_community_gamification.sql
-- Run after 008_growth_optimization.sql
--
--   1. users.quiet_hours_start/end — re-engagement pushes respect these
--   2. daily_community_stats materialized view — anonymized aggregate GL benchmarks
--   3. pg_cron refresh at 01:00 IST (19:30 UTC previous day)
--   4. get_user_percentile(user_id) RPC — "you ate better than N% of users"
--   5. Similarity Merge RPCs for ContributionModerator (pg_trgm-based)
-- =============================================================================

-- ── 1. QUIET HOURS ───────────────────────────────────────────────────────────
-- Stored as IST hour-of-day integers. Default 22:00–07:00 (sensible for India).
-- NULL = user disabled quiet hours entirely.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT DEFAULT 22
    CHECK (quiet_hours_start IS NULL OR quiet_hours_start BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS quiet_hours_end   SMALLINT DEFAULT 7
    CHECK (quiet_hours_end   IS NULL OR quiet_hours_end   BETWEEN 0 AND 23);

-- Server-side check (used by cron): is it currently quiet time for this user?
-- Handles the wrap-around window (22 → 7 crosses midnight).
CREATE OR REPLACE FUNCTION public.is_quiet_hours(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start SMALLINT;
  v_end   SMALLINT;
  v_now   SMALLINT;
BEGIN
  SELECT quiet_hours_start, quiet_hours_end INTO v_start, v_end
  FROM public.users WHERE id = p_user_id;

  IF v_start IS NULL OR v_end IS NULL THEN RETURN FALSE; END IF;

  v_now := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::SMALLINT;

  IF v_start <= v_end THEN
    RETURN v_now >= v_start AND v_now < v_end;        -- same-day window
  ELSE
    RETURN v_now >= v_start OR  v_now < v_end;        -- crosses midnight
  END IF;
END;
$$;

-- ── 2. COMMUNITY STATS MATERIALIZED VIEW ─────────────────────────────────────
-- PURELY AGGREGATED — no user_id, no food names, nothing identifying.
-- One row per IST date: distribution stats of total daily GL across all users
-- who logged ≥2 items that day (single-item days are noise, not diets).
CREATE MATERIALIZED VIEW IF NOT EXISTS public.daily_community_stats AS
WITH per_user_day AS (
  SELECT
    log_date,
    user_id,
    SUM(gl)  AS total_gl,
    SUM(cal) AS total_cal,
    COUNT(*) AS items
  FROM public.daily_logs
  WHERE log_date >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY log_date, user_id
  HAVING COUNT(*) >= 2
)
SELECT
  log_date,
  COUNT(*)                                            AS active_users,
  ROUND(AVG(total_gl)::NUMERIC, 1)                    AS avg_gl,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY total_gl) AS gl_p25,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_gl) AS gl_p50,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_gl) AS gl_p75,
  ROUND(AVG(total_cal)::NUMERIC, 0)                   AS avg_cal
FROM per_user_day
GROUP BY log_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_stats_date
  ON public.daily_community_stats (log_date);

-- No client access — served only through the percentile RPC (aggregation gate)
ALTER MATERIALIZED VIEW public.daily_community_stats OWNER TO postgres;

-- ── 3. SCHEDULED REFRESH — 01:00 IST = 19:30 UTC ────────────────────────────
-- Requires pg_cron (available on Supabase; enable in Dashboard → Extensions
-- if this CREATE EXTENSION errors, then re-run the cron.schedule line).
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'refresh-community-stats',
  '30 19 * * *',   -- 19:30 UTC = 01:00 IST next day
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.daily_community_stats$$
);

-- ── 4. USER PERCENTILE RPC ───────────────────────────────────────────────────
-- "You ate better than N% of users" for a given IST date (default: yesterday).
-- Lower GL = better rank. Requires ≥20 active users that day — below that,
-- percentiles are statistically embarrassing and we return sufficient=false.
CREATE OR REPLACE FUNCTION public.get_user_percentile(
  p_user_id UUID,
  p_date    DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date       DATE;
  v_user_gl    NUMERIC;
  v_better_than NUMERIC;
  v_active     INTEGER;
BEGIN
  v_date := COALESCE(p_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - 1);

  -- The user's own total for that day (≥2 items, same rule as the view)
  SELECT SUM(gl) INTO v_user_gl
  FROM public.daily_logs
  WHERE user_id = p_user_id AND log_date = v_date
  HAVING COUNT(*) >= 2;

  IF v_user_gl IS NULL THEN
    RETURN jsonb_build_object('sufficient', false, 'reason', 'no_user_data');
  END IF;

  SELECT active_users INTO v_active
  FROM public.daily_community_stats WHERE log_date = v_date;

  IF v_active IS NULL OR v_active < 20 THEN
    RETURN jsonb_build_object('sufficient', false, 'reason', 'community_too_small');
  END IF;

  -- Share of that day's users with HIGHER (worse) total GL — computed live
  -- against per-user aggregates; the view guards the "is it worth computing"
  -- gate, this query gives the exact rank.
  WITH per_user AS (
    SELECT user_id, SUM(gl) AS total_gl
    FROM public.daily_logs
    WHERE log_date = v_date
    GROUP BY user_id
    HAVING COUNT(*) >= 2
  )
  SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE total_gl > v_user_gl) / COUNT(*), 0)
  INTO v_better_than FROM per_user;

  RETURN jsonb_build_object(
    'sufficient',   true,
    'date',         v_date,
    'user_gl',      ROUND(v_user_gl, 0),
    'better_than',  v_better_than,      -- "you ate better than N% of users"
    'active_users', v_active
  );
END;
$$;

-- ── 5. SIMILARITY MERGE (Admin efficiency) ───────────────────────────────────
-- Trigram similarity against master_foods for a pending contribution's name.
-- pg_trgm (enabled in 001) is the right tool here: name-level duplicates are a
-- lexical problem ("Dal Tadka" vs "dal tadka homemade"), synchronous in the UI,
-- and needs no embedding round-trip. Threshold 0.5 trgm ≈ the spec's "obviously
-- the same dish" intent; the admin makes the final call either way.
CREATE OR REPLACE FUNCTION public.find_similar_master_foods(
  p_calling_admin_id UUID,
  p_name             TEXT,
  p_threshold        REAL DEFAULT 0.5,
  p_limit            INTEGER DEFAULT 3
)
RETURNS TABLE (
  food_id    UUID,
  food_name  TEXT,
  similarity REAL,
  calories   INTEGER,
  portion    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN QUERY
  SELECT m.id, m.name,
         similarity(lower(m.name), lower(p_name)) AS sim,
         m.calories, m.portion
  FROM public.master_foods m
  WHERE similarity(lower(m.name), lower(p_name)) > p_threshold
  ORDER BY sim DESC
  LIMIT p_limit;
END;
$$;

-- Merge: reject the contribution as a duplicate, pointing at the existing food.
-- Does NOT modify master_foods — the existing entry is already the truth;
-- the contribution's usage intent is satisfied by the merge target existing.
CREATE OR REPLACE FUNCTION public.merge_contribution_into_food(
  p_calling_admin_id UUID,
  p_contribution_id  UUID,
  p_target_food_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_name TEXT;
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT name INTO v_target_name FROM public.master_foods WHERE id = p_target_food_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target food not found');
  END IF;

  UPDATE public.food_contributions
  SET status           = 'rejected',
      reviewed_by      = p_calling_admin_id,
      reviewed_at      = NOW(),
      rejection_reason = 'Merged into existing food: ' || v_target_name
  WHERE id = p_contribution_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contribution not found or already reviewed');
  END IF;

  INSERT INTO public.events (user_id, event_name, properties, created_at)
  VALUES (p_calling_admin_id, 'contribution_merged',
    jsonb_build_object('contribution_id', p_contribution_id,
                       'target_food_id', p_target_food_id,
                       'target_name', v_target_name),
    NOW());

  RETURN jsonb_build_object('success', true, 'merged_into', v_target_name);
END;
$$;
