-- 015: behaviour analytics for the admin "Behaviour" screen.
-- Aggregates only: counts and percentages, never one person's food.
-- Server-only: the service role can call it, the app and the public cannot.

-- Keep the database small: the new noisy event types are trimmed after 4 to 6 months.
CREATE OR REPLACE FUNCTION public.admin_prune_logs()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.ai_call_log WHERE created_at < NOW() - INTERVAL '90 days';
  DELETE FROM public.events
   WHERE created_at < NOW() - INTERVAL '180 days'
     AND event_name IN ('screen_view', 'search_no_result', 'session_start');
  DELETE FROM public.events
   WHERE created_at < NOW() - INTERVAL '120 days'
     AND event_name IN ('app_error', 'api_error', 'slow_action');
  DELETE FROM public.admin_audit WHERE created_at < NOW() - INTERVAL '365 days';
$$;
REVOKE ALL ON FUNCTION public.admin_prune_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prune_logs() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_behaviour(p_days INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d        INTEGER := GREATEST(1, LEAST(COALESCE(p_days, 30), 180));
  today    DATE    := (now() AT TIME ZONE 'Asia/Kolkata')::DATE;
  kpis JSONB; weekly JSONB; streaks JSONB; breaks JSONB; hours JSONB; features JSONB;
  push JSONB; sources JSONB; device JSONB; errors JSONB; feedback JSONB; ai_edit JSONB;
  feat TEXT; r JSONB;
  feat_list TEXT[] := ARRAY['notifications_enabled','goals_saved','planner_applied','preset_applied',
                            'checkin_answered','app_opened_from_verdict','kitchen_profile_completed',
                            'ai_search_name','photo_search'];
BEGIN
  -- 1. Headline numbers (habit user = logged on 4 or more different days in the last 7)
  WITH last7 AS (
    SELECT user_id, COUNT(DISTINCT log_date) AS days
    FROM public.daily_logs WHERE log_date > today - 7 AND log_date <= today GROUP BY user_id),
  perday AS (
    SELECT user_id, log_date, COUNT(DISTINCT meal) AS meals
    FROM public.daily_logs WHERE log_date > today - d AND log_date <= today GROUP BY user_id, log_date)
  SELECT jsonb_build_object(
    'active_7d', (SELECT COUNT(*) FROM last7),
    'habit_7d',  (SELECT COUNT(*) FROM last7 WHERE days >= 4),
    'meals_per_active_day', COALESCE((SELECT ROUND(AVG(meals), 2) FROM perday), 0),
    'full_days_pct',        COALESCE((SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE meals >= 3) / NULLIF(COUNT(*), 0), 1) FROM perday), 0),
    'active_days', (SELECT COUNT(*) FROM perday))
  INTO kpis;

  -- 2. Habit users by week, last 12 weeks
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.week), '[]'::JSONB) INTO weekly FROM (
    SELECT week::TEXT AS week, COUNT(*) AS active, COUNT(*) FILTER (WHERE days >= 4) AS habit
    FROM (SELECT date_trunc('week', log_date)::DATE AS week, user_id, COUNT(DISTINCT log_date) AS days
          FROM public.daily_logs
          WHERE log_date >= (date_trunc('week', today::TIMESTAMP) - INTERVAL '11 weeks')::DATE AND log_date <= today
          GROUP BY 1, 2) x
    GROUP BY week) t;

  -- 3. Longest streak per person, bucketed; and the weekday streaks of 3+ days most often end on
  WITH dd AS (SELECT DISTINCT user_id, log_date FROM public.daily_logs),
  g AS (SELECT user_id, log_date, log_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY log_date))::INT AS grp FROM dd),
  isl AS (SELECT user_id, MIN(log_date) AS s, MAX(log_date) AS e, COUNT(*) AS len FROM g GROUP BY user_id, grp),
  best AS (SELECT user_id, MAX(len) AS len FROM isl GROUP BY user_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', b, 'users', n) ORDER BY ord), '[]'::JSONB) INTO streaks FROM (
    SELECT CASE WHEN len = 1 THEN '1 day' WHEN len = 2 THEN '2 days' WHEN len = 3 THEN '3 days'
                WHEN len <= 6 THEN '4 to 6 days' WHEN len <= 13 THEN '1 to 2 weeks' ELSE '2 weeks or more' END AS b,
           MIN(CASE WHEN len <= 3 THEN len WHEN len <= 6 THEN 4 WHEN len <= 13 THEN 7 ELSE 14 END) AS ord,
           COUNT(*) AS n
    FROM best GROUP BY 1) q;

  WITH dd AS (SELECT DISTINCT user_id, log_date FROM public.daily_logs),
  g AS (SELECT user_id, log_date, log_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY log_date))::INT AS grp FROM dd),
  isl AS (SELECT user_id, MAX(log_date) AS e, COUNT(*) AS len FROM g GROUP BY user_id, grp)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', to_char(date '2024-01-01' + (dow - 1), 'Dy'), 'n', n) ORDER BY dow), '[]'::JSONB) INTO breaks FROM (
    SELECT EXTRACT(ISODOW FROM e + 1)::INT AS dow, COUNT(*) AS n
    FROM isl WHERE len >= 3 AND e < today - 1 GROUP BY 1) q;

  -- 4. When people log (IST hour)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', h, 'n', COALESCE(n, 0)) ORDER BY h), '[]'::JSONB) INTO hours FROM (
    SELECT gs AS h, c.n FROM generate_series(0, 23) gs
    LEFT JOIN (SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::INT AS hr, COUNT(*) AS n
               FROM public.daily_logs WHERE log_date > today - d GROUP BY 1) c ON c.hr = gs) q;

  -- 5. Feature value: people who used it in their first 7 days vs people who did not,
  --    judged on whether they were still logging 14 to 30 days after signing up.
  features := '[]'::JSONB;
  FOREACH feat IN ARRAY feat_list LOOP
    WITH elig AS (SELECT id, created_at, created_at::DATE AS cd FROM public.users WHERE created_at <= now() - INTERVAL '31 days'),
    flag AS (
      SELECT e.id,
             EXISTS (SELECT 1 FROM public.events ev WHERE ev.user_id = e.id AND ev.event_name = feat
                       AND ev.created_at < e.created_at + INTERVAL '7 days') AS used_early,
             EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.user_id = e.id AND l.log_date BETWEEN e.cd + 14 AND e.cd + 30) AS kept
      FROM elig e)
    SELECT jsonb_build_object(
      'feature', feat,
      'users_used', (SELECT COUNT(DISTINCT user_id) FROM public.events WHERE event_name = feat AND created_at > now() - make_interval(days => d)),
      'repeat_users', (SELECT COUNT(*) FROM (SELECT user_id FROM public.events WHERE event_name = feat AND created_at > now() - INTERVAL '12 weeks'
                         GROUP BY user_id HAVING COUNT(DISTINCT date_trunc('week', created_at)) >= 2) z),
      'n_with',    COUNT(*) FILTER (WHERE used_early),     'kept_with',    COUNT(*) FILTER (WHERE used_early AND kept),
      'n_without', COUNT(*) FILTER (WHERE NOT used_early), 'kept_without', COUNT(*) FILTER (WHERE NOT used_early AND kept))
    INTO r FROM flag;
    features := features || jsonb_build_array(r);
  END LOOP;

  -- 6. Push messages: sent and opened (last 7 days), and the permission state per person (latest session)
  WITH latest AS (
    SELECT DISTINCT ON (user_id) user_id, properties->>'push' AS st
    FROM public.events WHERE event_name = 'session_start' AND created_at > now() - INTERVAL '30 days'
    ORDER BY user_id, created_at DESC)
  SELECT jsonb_build_object(
    'verdict_sent_7d',     (SELECT COUNT(*) FROM public.events WHERE event_name = 'verdict_sent' AND created_at > now() - INTERVAL '7 days'),
    'verdict_opened_7d',   (SELECT COUNT(*) FROM public.events WHERE event_name = 'app_opened_from_verdict' AND created_at > now() - INTERVAL '7 days'),
    'reengage_opened_7d',  (SELECT COUNT(*) FROM public.events WHERE event_name = 'app_opened_from_reengagement' AND created_at > now() - INTERVAL '7 days'),
    'checkin_opened_7d',   (SELECT COUNT(*) FROM public.events WHERE event_name = 'app_opened_from_checkin' AND created_at > now() - INTERVAL '7 days'),
    'checkin_answered_7d', (SELECT COUNT(*) FROM public.events WHERE event_name = 'checkin_answered' AND created_at > now() - INTERVAL '7 days'),
    'checkin_skipped_7d',  (SELECT COUNT(*) FROM public.events WHERE event_name = 'checkin_skipped' AND created_at > now() - INTERVAL '7 days'),
    'state', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', COALESCE(st, 'unknown'), 'n', n)) FROM (SELECT st, COUNT(*) AS n FROM latest GROUP BY st) q), '[]'::JSONB))
  INTO push;

  -- 7. Where people come from: first visit tag per person, and how many became habit users
  WITH first_ref AS (
    SELECT DISTINCT ON (user_id) user_id, COALESCE(NULLIF(properties->>'ref', ''), 'direct') AS ref
    FROM public.events WHERE event_name = 'session_start' ORDER BY user_id, created_at ASC),
  habit AS (
    SELECT DISTINCT user_id FROM (SELECT user_id, date_trunc('week', log_date) AS w FROM public.daily_logs
                                  GROUP BY 1, 2 HAVING COUNT(DISTINCT log_date) >= 4) z)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.users DESC), '[]'::JSONB) INTO sources FROM (
    SELECT f.ref, COUNT(*) AS users,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.daily_logs l WHERE l.user_id = f.user_id)) AS logged,
           COUNT(*) FILTER (WHERE f.user_id IN (SELECT user_id FROM habit)) AS habit
    FROM first_ref f GROUP BY f.ref ORDER BY users DESC LIMIT 8) t;

  -- 8. Phones, installs, languages, builds (latest session per person, last 30 days)
  WITH latest AS (
    SELECT DISTINCT ON (user_id) user_id, properties AS p
    FROM public.events WHERE event_name = 'session_start' AND created_at > now() - INTERVAL '30 days'
    ORDER BY user_id, created_at DESC)
  SELECT jsonb_build_object(
    'people', (SELECT COUNT(*) FROM latest),
    'os',      COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT COALESCE(p->>'os', 'unknown') AS k, COUNT(*) AS n FROM latest GROUP BY 1 ORDER BY 2 DESC LIMIT 6) q), '[]'::JSONB),
    'install', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT COALESCE(p->>'install', 'unknown') AS k, COUNT(*) AS n FROM latest GROUP BY 1 ORDER BY 2 DESC LIMIT 4) q), '[]'::JSONB),
    'lang',    COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT COALESCE(p->>'lang', 'unknown') AS k, COUNT(*) AS n FROM latest GROUP BY 1 ORDER BY 2 DESC LIMIT 6) q), '[]'::JSONB),
    'build',   COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT COALESCE(p->>'ver', 'unknown') AS k, COUNT(*) AS n FROM latest GROUP BY 1 ORDER BY 2 DESC LIMIT 5) q), '[]'::JSONB))
  INTO device;

  -- 9. App health: errors, failed and slow server calls
  SELECT jsonb_build_object(
    'active_days', (SELECT COUNT(*) FROM public.events WHERE event_name = 'session_start' AND created_at > now() - make_interval(days => d)),
    'app_errors',  (SELECT COUNT(*) FROM public.events WHERE event_name = 'app_error' AND created_at > now() - make_interval(days => d)),
    'api_errors',  (SELECT COUNT(*) FROM public.events WHERE event_name = 'api_error' AND created_at > now() - make_interval(days => d)),
    'top_errors', COALESCE((SELECT jsonb_agg(row_to_json(q)) FROM (
        SELECT properties->>'where' AS "where", properties->>'msg' AS msg, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users
        FROM public.events WHERE event_name = 'app_error' AND created_at > now() - make_interval(days => d)
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 8) q), '[]'::JSONB),
    'api_failures', COALESCE((SELECT jsonb_agg(row_to_json(q)) FROM (
        SELECT properties->>'path' AS path, properties->>'status' AS status, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users
        FROM public.events WHERE event_name = 'api_error' AND created_at > now() - make_interval(days => d)
        GROUP BY 1, 2 ORDER BY n DESC LIMIT 8) q), '[]'::JSONB),
    'slow', COALESCE((SELECT jsonb_agg(row_to_json(q)) FROM (
        SELECT properties->>'action' AS action, COUNT(*) AS n,
               ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY (properties->>'ms')::NUMERIC))::NUMERIC) AS p50_ms,
               ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY (properties->>'ms')::NUMERIC))::NUMERIC) AS p90_ms
        FROM public.events WHERE event_name = 'slow_action' AND created_at > now() - make_interval(days => d)
        GROUP BY 1 ORDER BY n DESC LIMIT 8) q), '[]'::JSONB))
  INTO errors;

  -- 10. What people said when asked
  SELECT jsonb_build_object(
    'sean_ellis', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (
        SELECT properties->>'answer' AS k, COUNT(*) AS n FROM public.events WHERE event_name = 'feedback_sean_ellis' GROUP BY 1 ORDER BY 2 DESC) q), '[]'::JSONB),
    'exit', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (
        SELECT properties->>'reason' AS k, COUNT(*) AS n FROM public.events WHERE event_name = 'feedback_exit' GROUP BY 1 ORDER BY 2 DESC) q), '[]'::JSONB))
  INTO feedback;

  -- 11. How often people change an AI or photo result before saving it
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'logged', logged, 'adjusted', adjusted)), '[]'::JSONB) INTO ai_edit FROM (
    SELECT properties->>'method' AS method, COUNT(*) AS logged,
           COUNT(*) FILTER (WHERE (properties->>'adjusted') = 'true') AS adjusted
    FROM public.events WHERE event_name = 'food_logged' AND created_at > now() - make_interval(days => d)
      AND properties ? 'adjusted'
    GROUP BY 1) q;

  RETURN jsonb_build_object('days', d, 'kpis', kpis, 'weekly', weekly, 'streaks', streaks, 'streak_breaks', breaks,
    'hours', hours, 'features', features, 'push', push, 'sources', sources, 'device', device,
    'errors', errors, 'feedback', feedback, 'edits', ai_edit);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_behaviour(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_behaviour(INTEGER) TO service_role;
