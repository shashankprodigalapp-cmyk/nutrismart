-- NutriSmart 2.0 / Phase 16: numbers for the 2.0 admin screen. Additive. Read only, service role only.
-- Everything is counted in the database. No guessing and no sampling.

CREATE OR REPLACE FUNCTION public.admin_platform_metrics() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d1 TIMESTAMPTZ := now() - interval '1 day';
  d7 TIMESTAMPTZ := now() - interval '7 days';
  d30 TIMESTAMPTZ := now() - interval '30 days';
  r JSONB;
BEGIN
  SELECT jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM users),
      'new_7d', (SELECT COUNT(*) FROM users WHERE created_at >= d7),
      'new_30d', (SELECT COUNT(*) FROM users WHERE created_at >= d30),
      'dau', (SELECT COUNT(DISTINCT user_id) FROM events WHERE event_name = 'session_start' AND created_at >= d1),
      'wau', (SELECT COUNT(DISTINCT user_id) FROM events WHERE event_name = 'session_start' AND created_at >= d7),
      'mau', (SELECT COUNT(DISTINCT user_id) FROM events WHERE event_name = 'session_start' AND created_at >= d30),
      'loggers_7d', (SELECT COUNT(DISTINCT user_id) FROM daily_logs WHERE created_at >= d7),
      -- of people who joined 8 to 30 days ago, the share who opened the app in the last 7 days
      'retained_pct', (SELECT CASE WHEN c.total = 0 THEN NULL ELSE ROUND(100.0 * c.back / c.total, 1) END
                       FROM (SELECT COUNT(*) AS total,
                                    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.event_name = 'session_start' AND e.created_at >= d7)) AS back
                             FROM users u WHERE u.created_at BETWEEN d30 AND now() - interval '8 days') c)
    ),
    'coaches', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM coach_profiles WHERE status = 'active'),
      'pending', (SELECT COUNT(*) FROM coach_profiles WHERE status = 'pending'),
      'suspended', (SELECT COUNT(*) FROM coach_profiles WHERE status = 'suspended'),
      'active_clients', (SELECT COUNT(DISTINCT client_id) FROM coach_client_relationships WHERE status = 'active' AND client_id IS NOT NULL),
      'pending_invites', (SELECT COUNT(*) FROM coach_client_relationships WHERE status = 'invited')
    ),
    'logging_7d', jsonb_build_object(
      'food_logs', (SELECT COUNT(*) FROM daily_logs WHERE created_at >= d7),
      'voice_logs', (SELECT COUNT(*) FROM events WHERE event_name = 'food_logged' AND properties->>'method' = 'voice' AND created_at >= d7),
      'photo_logs', (SELECT COUNT(*) FROM events WHERE event_name = 'food_logged' AND properties->>'method' = 'photo' AND created_at >= d7),
      'checkins', (SELECT COUNT(*) FROM daily_checkins WHERE created_at >= d7),
      'meal_feelings', (SELECT COUNT(*) FROM meal_feelings WHERE created_at >= d7)
    ),
    'ai_7d', jsonb_build_object(
      'calls', (SELECT COUNT(*) FROM ai_call_log WHERE created_at >= d7),
      'failures', (SELECT COUNT(*) FROM ai_call_log WHERE created_at >= d7 AND outcome <> 'ok'),
      'input_tokens', (SELECT COALESCE(SUM(input_tokens), 0) FROM ai_call_log WHERE created_at >= d7),
      'output_tokens', (SELECT COALESCE(SUM(output_tokens), 0) FROM ai_call_log WHERE created_at >= d7),
      'avg_latency_ms', (SELECT ROUND(AVG(latency_ms)) FROM ai_call_log WHERE created_at >= d7 AND outcome = 'ok'),
      'by_endpoint', COALESCE((SELECT jsonb_agg(jsonb_build_object('endpoint', endpoint, 'calls', n, 'failures', f, 'input_tokens', it, 'output_tokens', ot, 'avg_latency_ms', al) ORDER BY n DESC)
                               FROM (SELECT endpoint, COUNT(*) AS n, COUNT(*) FILTER (WHERE outcome <> 'ok') AS f, COALESCE(SUM(input_tokens),0) AS it, COALESCE(SUM(output_tokens),0) AS ot, ROUND(AVG(latency_ms)) AS al
                                     FROM ai_call_log WHERE created_at >= d7 GROUP BY endpoint) x), '[]'::jsonb),
      'recent_errors', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', created_at, 'endpoint', endpoint, 'provider', provider, 'outcome', outcome, 'http_status', http_status) ORDER BY created_at DESC)
                                 FROM (SELECT * FROM ai_call_log WHERE created_at >= d7 AND outcome <> 'ok' ORDER BY created_at DESC LIMIT 15) y), '[]'::jsonb)
    ),
    'reviews_7d', jsonb_build_object(
      'weekly', (SELECT COUNT(*) FROM ai_weekly_reviews WHERE generated_at >= d7),
      'monthly', (SELECT COUNT(*) FROM ai_monthly_reviews WHERE generated_at >= d7),
      'ai_written', (SELECT (SELECT COUNT(*) FROM ai_weekly_reviews WHERE generated_at >= d7 AND source = 'ai') + (SELECT COUNT(*) FROM ai_monthly_reviews WHERE generated_at >= d7 AND source = 'ai')),
      'waiting_for_coach', (SELECT (SELECT COUNT(*) FROM ai_weekly_reviews WHERE status = 'draft' AND NOT visible_to_client) + (SELECT COUNT(*) FROM ai_monthly_reviews WHERE status = 'draft' AND NOT visible_to_client))
    ),
    'notifications_7d', jsonb_build_object(
      'sent', (SELECT COUNT(*) FROM nudges WHERE created_at >= d7 AND status = 'sent'),
      'skipped', (SELECT COUNT(*) FROM nudges WHERE created_at >= d7 AND status = 'skipped'),
      'failed', (SELECT COUNT(*) FROM nudges WHERE created_at >= d7 AND status = 'failed'),
      'queued_now', (SELECT COUNT(*) FROM nudges WHERE status = 'queued'),
      'stuck_queued', (SELECT COUNT(*) FROM nudges WHERE status = 'queued' AND created_at < now() - interval '24 hours'),
      'devices', (SELECT COUNT(*) FROM push_subscriptions),
      'skip_reasons', COALESCE((SELECT jsonb_object_agg(skip_reason, n) FROM (SELECT skip_reason, COUNT(*) AS n FROM nudges WHERE created_at >= d7 AND status = 'skipped' AND skip_reason IS NOT NULL GROUP BY skip_reason) z), '{}'::jsonb)
    ),
    'subscriptions', jsonb_build_object(
      'by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status) s), '{}'::jsonb),
      'paid_active', (SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND plan <> 'free')
    ),
    'food_database', jsonb_build_object(
      'foods', (SELECT COUNT(*) FROM master_foods),
      'unverified', (SELECT COUNT(*) FROM master_foods WHERE COALESCE(verified, TRUE) = FALSE)
    )
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.admin_platform_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_metrics() TO service_role;
