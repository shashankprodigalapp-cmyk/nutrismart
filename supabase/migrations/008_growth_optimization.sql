-- =============================================================================
-- NutriSmart: 008_growth_optimization.sql
-- Run after 007_provisional_pro.sql
--
--   1. verdict_variant column on users — A/B assignment (sticky per user)
--   2. kitchen_impact_analysis RPC — which cooking factors drive crashes
--   3. retention_health_check RPC — log consistency vs verdict engagement
--   4. GIN maintenance strategy + partitioning verdict (comments, informed by data)
-- =============================================================================

-- ── 1. A/B VARIANT ASSIGNMENT ────────────────────────────────────────────────
-- Sticky assignment: hash of user id → variant. Deterministic, no coordination.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS verdict_variant TEXT
  GENERATED ALWAYS AS (
    CASE WHEN ('x' || substr(md5(id::text), 1, 8))::bit(32)::int % 2 = 0
      THEN 'scientific' ELSE 'coaching' END
  ) STORED;

-- ── 2. KITCHEN IMPACT ANALYSIS ───────────────────────────────────────────────
-- The defensible question: is it WHAT the user eats, or HOW it's cooked?
-- Splits every crash-preceding meal along three kitchen axes:
--   home vs restaurant · applied multiplier band · fat density of the meal.
-- Returns crash rates per axis so the UI can say:
--   "Your crashes are 2.3× more likely after restaurant meals"
--   "Heavy-oil home cooking (mult ≥1.15) precedes 68% of your crashes"

CREATE OR REPLACE FUNCTION public.kitchen_impact_analysis(
  p_user_id       UUID,
  p_lookback_days INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  WITH energy AS (
    SELECT level, log_date, created_at
    FROM public.energy_logs
    WHERE user_id = p_user_id
      AND log_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - p_lookback_days
  ),
  -- every meal 60–90 min before an energy log, tagged with the outcome
  correlated AS (
    SELECT
      d.is_home,
      d.multiplier,
      d.fat, d.cal, d.gl,
      (e.level = 'low') AS crashed
    FROM energy e
    JOIN public.daily_logs d
      ON d.user_id = p_user_id
      AND d.log_date = e.log_date
      AND d.created_at BETWEEN e.created_at - INTERVAL '90 minutes'
                           AND e.created_at - INTERVAL '60 minutes'
  ),
  axes AS (
    SELECT
      -- home vs restaurant
      COUNT(*) FILTER (WHERE NOT is_home AND crashed)::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE NOT is_home), 0)        AS rest_crash_rate,
      COUNT(*) FILTER (WHERE is_home AND crashed)::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE is_home), 0)            AS home_crash_rate,
      -- multiplier band (heavy oil ≥ 1.15)
      COUNT(*) FILTER (WHERE multiplier >= 1.15 AND crashed)::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE multiplier >= 1.15), 0) AS heavy_mult_crash_rate,
      COUNT(*) FILTER (WHERE multiplier < 1.15 AND crashed)::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE multiplier < 1.15), 0)  AS light_mult_crash_rate,
      -- fat density (fat kcal share > 40% of meal)
      COUNT(*) FILTER (WHERE fat * 9 > cal * 0.4 AND crashed)::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE fat * 9 > cal * 0.4), 0) AS fatty_crash_rate,
      COUNT(*) FILTER (WHERE fat * 9 <= cal * 0.4 AND crashed)::FLOAT
        / NULLIF(COUNT(*) FILTER (WHERE fat * 9 <= cal * 0.4), 0) AS lean_crash_rate,
      COUNT(*)                                                   AS n_total,
      COUNT(*) FILTER (WHERE crashed)                            AS n_crashes
    FROM correlated
  )
  SELECT jsonb_build_object(
    'n_total',    n_total,
    'n_crashes',  n_crashes,
    'sufficient', n_total >= 10,   -- axis analysis needs more data than food-level
    'axes', jsonb_build_object(
      'restaurant_vs_home', jsonb_build_object(
        'restaurant_crash_rate', ROUND(COALESCE(rest_crash_rate, 0)::NUMERIC, 2),
        'home_crash_rate',       ROUND(COALESCE(home_crash_rate, 0)::NUMERIC, 2)),
      'oil_multiplier', jsonb_build_object(
        'heavy_crash_rate', ROUND(COALESCE(heavy_mult_crash_rate, 0)::NUMERIC, 2),
        'light_crash_rate', ROUND(COALESCE(light_mult_crash_rate, 0)::NUMERIC, 2)),
      'fat_density', jsonb_build_object(
        'fatty_crash_rate', ROUND(COALESCE(fatty_crash_rate, 0)::NUMERIC, 2),
        'lean_crash_rate',  ROUND(COALESCE(lean_crash_rate, 0)::NUMERIC, 2))
    )
  ) INTO v_result FROM axes;

  RETURN v_result;
END;
$$;

-- ── 3. RETENTION HEALTH CHECK ────────────────────────────────────────────────
-- Two signals per user: did they log food, did they open/see the verdict
-- (verdict_viewed events written by VerdictDashboard). A user who logs but
-- ignored the verdict 3+ consecutive days gets flagged for re-engagement.

CREATE OR REPLACE FUNCTION public.retention_health_check(
  p_since_days        INTEGER DEFAULT 3,
  p_absent_hours      INTEGER DEFAULT 18   -- "truly away" threshold
)
RETURNS TABLE (
  user_id             UUID,
  days_logged         INTEGER,
  days_verdict_seen   INTEGER,
  hours_since_active  NUMERIC,
  needs_reengagement  BOOLEAN,
  last_food_logged    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH window_days AS (
    SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE - p_since_days AS since
  ),
  loggers AS (
    SELECT d.user_id AS uid, COUNT(DISTINCT d.log_date)::INT AS n_logged
    FROM public.daily_logs d, window_days w
    WHERE d.log_date >= w.since
    GROUP BY d.user_id
  ),
  verdict_views AS (
    SELECT e.user_id AS uid,
           COUNT(DISTINCT (e.created_at AT TIME ZONE 'Asia/Kolkata')::DATE)::INT AS n_seen
    FROM public.events e, window_days w
    WHERE e.event_name = 'verdict_viewed'
      AND (e.created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= w.since
    GROUP BY e.user_id
  ),
  -- Last ANY event from the user — true activity signal, not just food logging.
  -- If a user logged food 20 min ago via the quick-log widget, they're in the
  -- app right now. Re-engaging them is spam. The p_absent_hours threshold
  -- (default 18h) ensures we only nudge genuinely absent users.
  last_activity AS (
    SELECT e.user_id AS uid,
           EXTRACT(EPOCH FROM (NOW() - MAX(e.created_at))) / 3600.0 AS hours_since
    FROM public.events e
    GROUP BY e.user_id
  ),
  favorites AS (
    SELECT DISTINCT ON (d.user_id) d.user_id AS uid, d.food_name
    FROM public.daily_logs d
    ORDER BY d.user_id, d.created_at DESC
  )
  SELECT
    l.uid,
    l.n_logged,
    COALESCE(v.n_seen, 0),
    ROUND(COALESCE(a.hours_since, 9999)::NUMERIC, 1),
    (
      l.n_logged >= p_since_days              -- logged food (habit intact)
      AND COALESCE(v.n_seen, 0) = 0          -- never viewed the verdict
      AND COALESCE(a.hours_since, 9999) >= p_absent_hours  -- truly away from app
    ),
    f.food_name
  FROM loggers l
  LEFT JOIN verdict_views v ON v.uid = l.uid
  LEFT JOIN last_activity  a ON a.uid = l.uid
  LEFT JOIN favorites      f ON f.uid = l.uid;
END;
$$;

-- =============================================================================
-- ── 4. DATABASE MAINTENANCE VERDICTS (informed, not generic) ─────────────────
--
-- A) GIN on master_foods: GIN pending-list bloat is the real issue — inserts
--    buffer into a pending list that slows lookups until merged. Crowdsourced
--    approvals are low-velocity (admin-gated), so monthly is enough:
--
--      VACUUM ANALYZE public.master_foods;   -- merges GIN pending lists
--
--    If approvals ever exceed ~100/day, set per-index:
--      ALTER INDEX idx_master_foods_search SET (gin_pending_list_limit = 512);
--
-- B) Partitioning daily_logs — VERDICT: NOT YET, and not soon.
--    6-month projection at optimistic 5,000 DAU × 8 logs/day ≈ 7.3M rows.
--    A 7M-row table with (user_id, log_date DESC) composite btree serves
--    "one user, one day" queries in single-digit ms — partition pruning would
--    save nothing because the index already isolates the working set.
--    Partitioning earns its complexity at ~100M+ rows or when bulk-dropping
--    old data by range. Revisit trigger: p95 on the dashboard's daily query
--    exceeding 50ms, or table size > 20GB. Until then it's pure risk
--    (FK complications with RLS, no ON CONFLICT across partitions pre-PG15
--    quirks) for zero user-visible gain.
-- =============================================================================
