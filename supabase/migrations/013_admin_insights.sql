-- =============================================================================
-- NutriSmart 013: admin insights, AI call log, free-tier tracking
-- Run once in Supabase -> SQL Editor. Safe to run again.
-- Everything here is server-side only: no policies are added, so the app
-- (browser) can never read these tables. Only the service key can.
-- =============================================================================

-- 1. Every real call to Gemini / Claude (cache hits are not calls and are not logged here)
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  endpoint      TEXT NOT NULL,            -- name | describe | vision | vision_lookup | embed
  provider      TEXT NOT NULL,            -- gemini | claude
  model         TEXT,
  outcome       TEXT NOT NULL,            -- ok | rate_limited | http_error | network_error
  http_status   INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  latency_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_created ON public.ai_call_log (created_at DESC);
ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

-- 2. Settings the owner can change from the admin screen (e.g. the Gemini daily limit)
CREATE TABLE IF NOT EXISTS public.admin_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- 3. Who opened the admin insights (trust and DPDP accountability)
CREATE TABLE IF NOT EXISTS public.admin_audit (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID NOT NULL,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON public.admin_audit (admin_id, created_at DESC);
ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

-- 4. Keep the free database small: drop old noisy rows
CREATE OR REPLACE FUNCTION public.admin_prune_logs()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.ai_call_log WHERE created_at < NOW() - INTERVAL '90 days';
  DELETE FROM public.events
   WHERE created_at < NOW() - INTERVAL '180 days'
     AND event_name IN ('screen_view', 'search_no_result');
  DELETE FROM public.admin_audit WHERE created_at < NOW() - INTERVAL '365 days';
$$;

-- 5. One call that returns all dashboard numbers (aggregates only, no food names per user)
CREATE OR REPLACE FUNCTION public.admin_insights(p_days INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  d       INTEGER := GREATEST(1, LEAST(COALESCE(p_days, 30), 180));
  today   DATE    := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  ptoday  DATE    := (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE;
  res JSONB; kpis JSONB; funnel JSONB; retention JSONB; daily JSONB; top_foods JSONB; meals JSONB;
  methods JSONB; misses JSONB; features JSONB; screens JSONB; ai_daily JSONB; ai_endpoints JSONB;
  ai_today JSONB; ai_cache JSONB; sys JSONB; segments JSONB; tables_json JSONB;
  storage_bytes BIGINT := 0; mau_auth INTEGER := 0; auth_total INTEGER := 0;
BEGIN
  -- KPIs -----------------------------------------------------------------------
  SELECT jsonb_build_object(
    'total_users',   (SELECT COUNT(*) FROM public.users),
    'signups_7d',    (SELECT COUNT(*) FROM public.users WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= today - 6),
    'signups_30d',   (SELECT COUNT(*) FROM public.users WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= today - 29),
    'active_today',  (SELECT COUNT(DISTINCT user_id) FROM public.daily_logs WHERE log_date = today),
    'wau',           (SELECT COUNT(DISTINCT user_id) FROM public.daily_logs WHERE log_date >= today - 6),
    'mau',           (SELECT COUNT(DISTINCT user_id) FROM public.daily_logs WHERE log_date >= today - 29),
    'logs_today',    (SELECT COUNT(*) FROM public.daily_logs WHERE log_date = today),
    'logs_7d',       (SELECT COUNT(*) FROM public.daily_logs WHERE log_date >= today - 6)
  ) INTO kpis;

  -- Activation funnel for people who signed up in the window ----------------------
  WITH per AS (
    SELECT u.id, u.created_at,
      EXISTS (SELECT 1 FROM public.kitchen_profiles k WHERE k.user_id = u.id) AS onboarded,
      (SELECT MIN(l.created_at) FROM public.daily_logs l WHERE l.user_id = u.id) AS first_log_at,
      (SELECT COUNT(DISTINCT l.log_date) FROM public.daily_logs l WHERE l.user_id = u.id) AS log_days
    FROM public.users u
    WHERE (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= today - d + 1
  )
  SELECT jsonb_build_object(
    'signed_up',        COUNT(*),
    'onboarded',        COUNT(*) FILTER (WHERE onboarded),
    'first_log',        COUNT(*) FILTER (WHERE first_log_at IS NOT NULL),
    'first_log_24h',    COUNT(*) FILTER (WHERE first_log_at IS NOT NULL AND first_log_at <= created_at + INTERVAL '24 hours'),
    'logged_2_days',    COUNT(*) FILTER (WHERE log_days >= 2),
    'logged_3_days',    COUNT(*) FILTER (WHERE log_days >= 3)
  ) INTO funnel FROM per;

  -- Weekly signup cohorts: did they log again on day 1 / around day 7 / around day 30 -----
  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.week DESC), '[]'::JSONB) INTO retention FROM (
    SELECT wk AS week, COUNT(*) AS size,
      COUNT(*) FILTER (WHERE sd + 1  <= today) AS eligible_d1,  COUNT(*) FILTER (WHERE sd + 1  <= today AND r1)  AS retained_d1,
      COUNT(*) FILTER (WHERE sd + 8  <= today) AS eligible_d7,  COUNT(*) FILTER (WHERE sd + 8  <= today AND r7)  AS retained_d7,
      COUNT(*) FILTER (WHERE sd + 32 <= today) AS eligible_d30, COUNT(*) FILTER (WHERE sd + 32 <= today AND r30) AS retained_d30
    FROM (
      SELECT DATE_TRUNC('week', (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE)::DATE AS wk,
             (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS sd,
             EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.user_id = u.id AND l.log_date = (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE + 1) AS r1,
             EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.user_id = u.id AND l.log_date BETWEEN (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE + 6  AND (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE + 8)  AS r7,
             EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.user_id = u.id AND l.log_date BETWEEN (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE + 28 AND (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE + 32) AS r30
      FROM public.users u
      WHERE (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= today - 56
    ) x GROUP BY wk
  ) c;

  -- Day by day: sign-ups, active users, meals logged --------------------------------
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', g.day, 'signups', COALESCE(s.n, 0), 'active', COALESCE(a.n, 0), 'logs', COALESCE(a.logs, 0)) ORDER BY g.day), '[]'::JSONB)
  INTO daily
  FROM (SELECT generate_series(today - d + 1, today, INTERVAL '1 day')::DATE AS day) g
  LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day, COUNT(*) AS n FROM public.users GROUP BY 1) s ON s.day = g.day
  LEFT JOIN (SELECT log_date AS day, COUNT(DISTINCT user_id) AS n, COUNT(*) AS logs FROM public.daily_logs GROUP BY 1) a ON a.day = g.day;

  -- What people eat -----------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO top_foods FROM (
    SELECT food_name AS name, COUNT(*) AS logs, COUNT(DISTINCT user_id) AS users
    FROM public.daily_logs WHERE log_date >= today - d + 1
    GROUP BY food_name ORDER BY COUNT(*) DESC LIMIT 15) t;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO meals FROM (
    SELECT meal, COUNT(*) AS logs FROM public.daily_logs WHERE log_date >= today - d + 1 GROUP BY meal ORDER BY COUNT(*) DESC) t;

  -- Behaviour events ------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO methods FROM (
    SELECT COALESCE(properties->>'method', 'unknown') AS method, COUNT(*) AS logs
    FROM public.events WHERE event_name = 'food_logged' AND created_at >= NOW() - (d || ' days')::INTERVAL
    GROUP BY 1 ORDER BY COUNT(*) DESC) t;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO misses FROM (
    SELECT LOWER(properties->>'q') AS query, COUNT(*) AS searches, COUNT(DISTINCT user_id) AS users
    FROM public.events WHERE event_name = 'search_no_result' AND created_at >= NOW() - (d || ' days')::INTERVAL
      AND COALESCE(properties->>'q', '') <> ''
    GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 20) t;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO features FROM (
    SELECT event_name AS name, COUNT(*) AS events, COUNT(DISTINCT user_id) AS users
    FROM public.events WHERE created_at >= NOW() - (d || ' days')::INTERVAL
      AND event_name NOT IN ('screen_view', 'search_no_result', 'food_logged')
    GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 25) t;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO screens FROM (
    SELECT COALESCE(properties->>'screen', 'unknown') AS screen, COUNT(*) AS views, COUNT(DISTINCT user_id) AS users
    FROM public.events WHERE event_name = 'screen_view' AND created_at >= NOW() - (d || ' days')::INTERVAL
    GROUP BY 1 ORDER BY COUNT(*) DESC) t;

  -- AI usage (real provider calls; Google resets its daily quota at midnight US Pacific) ----
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day), '[]'::JSONB) INTO ai_daily FROM (
    SELECT (created_at AT TIME ZONE 'America/Los_Angeles')::DATE AS day,
      COUNT(*) AS calls,
      COUNT(*) FILTER (WHERE outcome = 'ok') AS ok,
      COUNT(*) FILTER (WHERE http_status = 429) AS limited,
      COUNT(*) FILTER (WHERE outcome <> 'ok' AND COALESCE(http_status, 0) <> 429) AS errors,
      COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM public.ai_call_log WHERE created_at >= NOW() - INTERVAL '15 days' GROUP BY 1) t;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO ai_endpoints FROM (
    SELECT endpoint, provider, COUNT(*) AS calls, COUNT(*) FILTER (WHERE outcome = 'ok') AS ok,
           COALESCE(ROUND(AVG(latency_ms)), 0) AS avg_ms
    FROM public.ai_call_log WHERE created_at >= NOW() - (d || ' days')::INTERVAL
    GROUP BY endpoint, provider ORDER BY COUNT(*) DESC) t;
  SELECT jsonb_build_object(
    'pacific_date', ptoday,
    'gemini_calls', COUNT(*) FILTER (WHERE provider = 'gemini'),
    'gemini_limited', COUNT(*) FILTER (WHERE provider = 'gemini' AND http_status = 429),
    'claude_calls', COUNT(*) FILTER (WHERE provider = 'claude'),
    'peak_per_minute_24h', COALESCE((SELECT MAX(c) FROM (
        SELECT COUNT(*) AS c FROM public.ai_call_log
        WHERE provider = 'gemini' AND created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY DATE_TRUNC('minute', created_at)) m), 0)
  ) INTO ai_today FROM public.ai_call_log WHERE (created_at AT TIME ZONE 'America/Los_Angeles')::DATE = ptoday;
  IF ai_today IS NULL THEN ai_today := jsonb_build_object('pacific_date', ptoday, 'gemini_calls', 0, 'gemini_limited', 0, 'claude_calls', 0, 'peak_per_minute_24h', 0); END IF;
  SELECT jsonb_build_object(
    'lookups',   COUNT(*),
    'cache_hits', COUNT(*) FILTER (WHERE properties->>'cache_hit' = 'true'),
    'users',     COUNT(DISTINCT user_id)
  ) INTO ai_cache FROM public.events
  WHERE event_name IN ('ai_search_name', 'ai_search_describe', 'photo_search') AND created_at >= NOW() - (d || ' days')::INTERVAL;

  -- System health (Supabase free plan: 500 MB database, 1 GB files, 50,000 monthly users) ----
  BEGIN
    SELECT COALESCE(SUM((metadata->>'size')::BIGINT), 0) INTO storage_bytes FROM storage.objects;
  EXCEPTION WHEN OTHERS THEN storage_bytes := 0; END;
  BEGIN
    SELECT COUNT(*) FILTER (WHERE last_sign_in_at >= NOW() - INTERVAL '30 days'), COUNT(*) INTO mau_auth, auth_total FROM auth.users;
  EXCEPTION WHEN OTHERS THEN mau_auth := 0; auth_total := 0; END;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO tables_json FROM (
    SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, GREATEST(c.reltuples, 0)::BIGINT AS rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 8) t;
  SELECT jsonb_build_object(
    'db_bytes',        pg_database_size(current_database()),
    'storage_bytes',   storage_bytes,
    'mau_auth',        mau_auth,
    'auth_users',      auth_total,
    'push_devices',    (SELECT COUNT(*) FROM public.push_subscriptions),
    'push_users',      (SELECT COUNT(DISTINCT user_id) FROM public.push_subscriptions),
    'verdicts_sent_7d',(SELECT COUNT(*) FROM public.events WHERE event_name = 'verdict_sent' AND created_at >= NOW() - INTERVAL '7 days'),
    'energy_ratings',  (SELECT COUNT(*) FROM public.energy_logs WHERE log_date >= today - d + 1),
    'tables',          tables_json
  ) INTO sys;

  -- Segments (counts only) --------------------------------------------------------------
  WITH s AS (
    SELECT u.id,
      (SELECT COUNT(DISTINCT l.log_date) FROM public.daily_logs l WHERE l.user_id = u.id AND l.log_date >= today - 6) AS d7,
      EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.user_id = u.id) AS ever,
      (SELECT COUNT(*) FROM public.events e WHERE e.user_id = u.id AND e.created_at >= NOW() - INTERVAL '7 days'
         AND e.event_name IN ('ai_search_name', 'ai_search_describe', 'photo_search')) AS ai7
    FROM public.users u)
  SELECT jsonb_build_object(
    'daily_loggers',  COUNT(*) FILTER (WHERE d7 >= 5),
    'casual',         COUNT(*) FILTER (WHERE d7 BETWEEN 1 AND 4),
    'dormant',        COUNT(*) FILTER (WHERE d7 = 0 AND ever),
    'never_logged',   COUNT(*) FILTER (WHERE NOT ever),
    'ai_heavy',       COUNT(*) FILTER (WHERE ai7 >= 3)
  ) INTO segments FROM s;

  res := jsonb_build_object(
    'today_ist', today, 'days', d, 'kpis', kpis, 'funnel', funnel, 'retention', retention, 'daily', daily,
    'top_foods', top_foods, 'meals', meals, 'log_methods', methods, 'search_misses', misses,
    'features', features, 'screens', screens, 'ai_daily', ai_daily, 'ai_endpoints', ai_endpoints,
    'ai_today', ai_today, 'ai_cache', ai_cache, 'system', sys, 'segments', segments);
  RETURN res;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_insights(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_insights(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_prune_logs() TO service_role;
