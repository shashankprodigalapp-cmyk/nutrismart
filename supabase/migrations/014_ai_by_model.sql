-- 014: per-model AI usage for today (Google's day = US Pacific), used by the Free tier screen.
-- Server-only: service role can call it, the app and the public cannot.
CREATE OR REPLACE FUNCTION public.admin_ai_by_model()
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH today AS (
    SELECT model, created_at, outcome
    FROM public.ai_call_log
    WHERE provider = 'gemini'
      AND (created_at AT TIME ZONE 'America/Los_Angeles')::DATE = (now() AT TIME ZONE 'America/Los_Angeles')::DATE
  ),
  per_minute AS (
    SELECT model, MAX(c) AS peak
    FROM (SELECT model, date_trunc('minute', created_at) AS m, COUNT(*) AS c FROM today GROUP BY 1, 2) x
    GROUP BY model
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'model', t.model, 'calls', t.calls, 'limited', t.limited, 'peak_per_minute', COALESCE(p.peak, 0))), '[]'::JSONB)
  FROM (
    SELECT model, COUNT(*) AS calls, COUNT(*) FILTER (WHERE outcome = 'rate_limited') AS limited
    FROM today GROUP BY model
  ) t LEFT JOIN per_minute p USING (model);
$$;

REVOKE ALL ON FUNCTION public.admin_ai_by_model() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_by_model() TO service_role;
