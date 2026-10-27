-- NutriSmart 2.0 / Phase 19: security hardening. Additive.
-- 1. Short-window rate limits for the 2.0 endpoints.
-- 2. erase_user_traces(): removes a deleted person's id from rows that must stay (audit log, review decisions).

CREATE TABLE IF NOT EXISTS public.v2_rate_limits (
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bucket       TEXT NOT NULL CHECK (bucket ~ '^[a-z0-9_]{2,40}$'),
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, window_start)
);
ALTER TABLE public.v2_rate_limits ENABLE ROW LEVEL SECURITY;  -- no policies: server only

CREATE OR REPLACE FUNCTION public.v2_hit(p_user UUID, p_bucket TEXT, p_window_secs INTEGER, p_max INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w TIMESTAMPTZ; n INTEGER;
BEGIN
  IF p_window_secs < 1 OR p_window_secs > 86400 OR p_max < 1 THEN RAISE EXCEPTION 'bad limit'; END IF;
  w := to_timestamp(floor(extract(epoch FROM now()) / p_window_secs) * p_window_secs);
  INSERT INTO v2_rate_limits (user_id, bucket, window_start, count) VALUES (p_user, p_bucket, w, 1)
  ON CONFLICT (user_id, bucket, window_start) DO UPDATE SET count = v2_rate_limits.count + 1
  RETURNING count INTO n;
  IF random() < 0.01 THEN DELETE FROM v2_rate_limits WHERE window_start < now() - interval '2 days'; END IF;
  RETURN jsonb_build_object('allowed', n <= p_max, 'count', n, 'retry_after', GREATEST(1, CEIL(extract(epoch FROM (w + (p_window_secs || ' seconds')::interval - now())))::int));
END $$;
REVOKE ALL ON FUNCTION public.v2_hit(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_hit(UUID, TEXT, INTEGER, INTEGER) TO service_role;

-- Called by delete-my-account just before the sign-in record is removed.
-- The rows stay (they belong to someone else's history) but no longer name the deleted person.
CREATE OR REPLACE FUNCTION public.erase_user_traces(p_user UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE ai_weekly_reviews SET decided_by = NULL WHERE decided_by = p_user;
  UPDATE ai_monthly_reviews SET decided_by = NULL WHERE decided_by = p_user;
  UPDATE coach_client_relationships SET ended_by = NULL WHERE ended_by = p_user;
  UPDATE food_contributions SET reviewed_by = NULL WHERE reviewed_by = p_user;
  UPDATE audit_logs SET actor_id = NULL WHERE actor_id = p_user;
  UPDATE audit_logs SET target_user = NULL WHERE target_user = p_user;
  UPDATE audit_logs SET meta = '{}'::jsonb WHERE meta::text LIKE '%' || p_user::text || '%';
END $$;
REVOKE ALL ON FUNCTION public.erase_user_traces(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_user_traces(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes found in the Phase 19 audit of 1.0 functions (behaviour for working callers is unchanged)
-- ─────────────────────────────────────────────────────────────────────────────

-- The role of the current request: 'service_role' for the server, 'authenticated' for a signed-in browser, 'anon' otherwise.
CREATE OR REPLACE FUNCTION public.request_role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                  (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
$$;

-- 1. Admin RPCs take "p_calling_admin_id" from the caller. Until now anyone who knew an admin's id could pass it.
--    Now the id must be the signed-in caller's own id, or the request must come from the server (service role).
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- COALESCE matters: a NULL answer would slip past "IF NOT is_admin(...)" checks.
  SELECT COALESCE(EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = p_user_id)
     AND (p_user_id = auth.uid() OR public.request_role() = 'service_role'), FALSE);
$$;

-- 2. Server-only helpers were callable by any signed-in person. grant_provisional_pro let a user give themselves Pro.
REVOKE ALL ON FUNCTION public.grant_provisional_pro(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_provisional_pro(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_rate_limit(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_quiet_hours(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retention_health_check(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_distinct_users_since(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_percentile(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_provisional_pro(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_provisional_pro(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(UUID, TIMESTAMPTZ, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_quiet_hours(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retention_health_check(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_distinct_users_since(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_percentile(UUID, DATE) TO service_role;

-- 3. kitchen_impact_analysis(user, days) returned any person's energy and food pattern to any caller.
--    The original becomes an internal function; the public one only answers for the caller (or the server).
DO $$ BEGIN
  IF to_regprocedure('public.kitchen_impact_analysis_impl(uuid,integer)') IS NULL THEN
    ALTER FUNCTION public.kitchen_impact_analysis(UUID, INTEGER) RENAME TO kitchen_impact_analysis_impl;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.kitchen_impact_analysis_impl(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kitchen_impact_analysis_impl(UUID, INTEGER) TO service_role;
CREATE OR REPLACE FUNCTION public.kitchen_impact_analysis(p_user_id UUID, p_lookback_days INTEGER DEFAULT 60) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND public.request_role() <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  RETURN public.kitchen_impact_analysis_impl(p_user_id, p_lookback_days);
END $$;
REVOKE ALL ON FUNCTION public.kitchen_impact_analysis(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kitchen_impact_analysis(UUID, INTEGER) TO authenticated, service_role;
