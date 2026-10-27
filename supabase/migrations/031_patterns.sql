-- NutriSmart 2.0 / Phase 14: pattern engine input. Additive.
-- One row per meal the person logged, with what was in it and how they said it felt afterwards.
-- SECURITY INVOKER on purpose: row-level security applies, so a coach sees only what the client shared.
-- The pattern rules themselves run in code (src/lib/patterns.ts) so they can be tested and explained.

CREATE OR REPLACE FUNCTION public.meal_outcomes(p_user UUID, p_days INTEGER DEFAULT 60)
RETURNS TABLE (
  log_date DATE, meal TEXT, cal NUMERIC, protein NUMERIC, carbs NUMERIC, fat NUMERIC, gl NUMERIC, logged_hour INTEGER,
  energy_level TEXT, energy_change TEXT, fullness TEXT, mood_change TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH win AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date - (LEAST(GREATEST(COALESCE(p_days, 60), 1), 120) - 1) AS from_day),
  m AS (
    SELECT d.log_date, d.meal, SUM(d.cal) AS cal, SUM(d.protein) AS protein, SUM(d.carbs) AS carbs, SUM(d.fat) AS fat, SUM(d.gl) AS gl,
           EXTRACT(HOUR FROM MIN(d.created_at) AT TIME ZONE 'Asia/Kolkata')::int AS logged_hour
    FROM public.daily_logs d, win
    WHERE d.user_id = p_user AND d.log_date >= win.from_day
    GROUP BY d.log_date, d.meal
  ),
  e AS (
    SELECT DISTINCT ON (x.log_date, x.meal_before) x.log_date, x.meal_before AS meal, x.level
    FROM public.energy_logs x, win
    WHERE x.user_id = p_user AND x.log_date >= win.from_day AND x.meal_before IS NOT NULL
    ORDER BY x.log_date, x.meal_before, x.log_time DESC
  )
  SELECT m.log_date, m.meal, m.cal, m.protein, m.carbs, m.fat, m.gl, m.logged_hour,
         e.level, f.energy_change, f.fullness, f.mood_change
  FROM m
  LEFT JOIN e ON e.log_date = m.log_date AND e.meal = m.meal
  LEFT JOIN public.meal_feelings f ON f.user_id = p_user AND f.log_date = m.log_date AND f.meal = m.meal
  ORDER BY m.log_date, m.meal;
$$;
GRANT EXECUTE ON FUNCTION public.meal_outcomes(UUID, INTEGER) TO authenticated;

INSERT INTO public.feature_flags (key, enabled, description) VALUES ('v2_patterns', FALSE, 'Personal meal patterns on the Energy and mood page (2.0)') ON CONFLICT (key) DO NOTHING;
