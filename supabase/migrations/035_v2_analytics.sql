-- NutriSmart 2.0 / Phase 18: 2.0 adoption analytics for admin. Additive, read only, service role only.
-- Counts of people and rows. No food names, no notes, no mood values leave the database.

CREATE OR REPLACE FUNCTION public.admin_v2_analytics(p_days INTEGER DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d INTEGER := GREATEST(1, LEAST(COALESCE(p_days, 30), 180));
  since TIMESTAMPTZ := now() - (GREATEST(1, LEAST(COALESCE(p_days, 30), 180)) || ' days')::interval;
  today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::DATE;
  adoption JSONB; coach JSONB; review JSONB; experiments JSONB; cohorts JSONB;
BEGIN
  adoption := jsonb_build_object(
    'active_people',     (SELECT COUNT(DISTINCT user_id) FROM daily_logs WHERE created_at >= since),
    'food_logging',      (SELECT COUNT(DISTINCT user_id) FROM daily_logs WHERE created_at >= since),
    'voice_logging',     (SELECT COUNT(DISTINCT user_id) FROM events WHERE event_name = 'food_logged' AND properties->>'method' = 'voice' AND created_at >= since),
    'photo_logging',     (SELECT COUNT(DISTINCT user_id) FROM events WHERE event_name = 'food_logged' AND properties->>'method' = 'photo' AND created_at >= since),
    'daily_checkins',    (SELECT COUNT(DISTINCT user_id) FROM daily_checkins WHERE created_at >= since),
    'meal_feelings',     (SELECT COUNT(DISTINCT user_id) FROM meal_feelings WHERE created_at >= since),
    'flexible_meals',    (SELECT COUNT(DISTINCT user_id) FROM flexible_meals WHERE created_at >= since),
    'experiments',       (SELECT COUNT(DISTINCT user_id) FROM experiments WHERE created_at >= since),
    'weekly_reviews',    (SELECT COUNT(DISTINCT user_id) FROM ai_weekly_reviews WHERE generated_at >= since),
    'monthly_reviews',   (SELECT COUNT(DISTINCT user_id) FROM ai_monthly_reviews WHERE generated_at >= since),
    'reminders_enabled', (SELECT COUNT(*) FROM nudge_preferences WHERE log_reminders IS TRUE)
  );

  coach := jsonb_build_object(
    'applied',            (SELECT COUNT(*) FROM coach_profiles),
    'approved',           (SELECT COUNT(*) FROM coach_profiles WHERE status = 'active'),
    'invited_someone',    (SELECT COUNT(DISTINCT coach_id) FROM coach_client_relationships),
    'has_active_client',  (SELECT COUNT(DISTINCT coach_id) FROM coach_client_relationships WHERE status = 'active'),
    'client_logged_7d',   (SELECT COUNT(DISTINCT r.coach_id) FROM coach_client_relationships r
                            WHERE r.status = 'active' AND EXISTS (SELECT 1 FROM daily_logs l WHERE l.user_id = r.client_id AND l.log_date > today - 7)),
    'invites_sent',       (SELECT COUNT(*) FROM coach_client_relationships WHERE invited_at >= since),
    'invites_accepted',   (SELECT COUNT(*) FROM coach_client_relationships WHERE invited_at >= since AND accepted_at IS NOT NULL),
    'coach_nudges_sent',  (SELECT COUNT(*) FROM nudges WHERE kind = 'coach_message' AND status = 'sent' AND created_at >= since)
  );

  review := jsonb_build_object(
    'weekly_by_status',  COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, COUNT(*) n FROM ai_weekly_reviews WHERE generated_at >= since GROUP BY status) s), '{}'::jsonb),
    'monthly_by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, COUNT(*) n FROM ai_monthly_reviews WHERE generated_at >= since GROUP BY status) s), '{}'::jsonb),
    'weekly_by_source',  COALESCE((SELECT jsonb_object_agg(source, n) FROM (SELECT source, COUNT(*) n FROM ai_weekly_reviews WHERE generated_at >= since GROUP BY source) s), '{}'::jsonb)
  );

  experiments := COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, COUNT(*) n FROM experiments WHERE created_at >= since GROUP BY status) s), '{}'::jsonb);

  -- Weekly sign-up cohorts (IST weeks starting Monday), last 6. "Came back" = logged food 7 or more days after signing up.
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.week_start), '[]'::jsonb) INTO cohorts FROM (
    SELECT c.week_start,
           COUNT(*) AS size,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM daily_logs l WHERE l.user_id = c.id AND l.log_date < c.signup + 7)) AS logged_first_week,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM daily_logs l WHERE l.user_id = c.id AND l.log_date >= c.signup + 7)) AS came_back
    FROM (SELECT u.id, (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS signup,
                 date_trunc('week', u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS week_start
          FROM users u) c
    WHERE c.week_start >= date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')::DATE - 35
    GROUP BY c.week_start
  ) t;

  RETURN jsonb_build_object('days', d, 'adoption', adoption, 'coach', coach, 'reviews', review, 'experiments', experiments, 'cohorts', cohorts);
END $$;
REVOKE ALL ON FUNCTION public.admin_v2_analytics(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_v2_analytics(INTEGER) TO service_role;
