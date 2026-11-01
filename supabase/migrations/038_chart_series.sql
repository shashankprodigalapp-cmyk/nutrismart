-- NutriSmart 2.0: day-by-day numbers for the admin and coach charts. Additive, read only. IST days.
-- Admin: counts of people and rows only (no names, no food, no mood values). Service role only, called by /api/admin-series.
-- Coach: only active clients who shared food (energy only where energy is shared). Same privacy rules as coach_dashboard.

CREATE OR REPLACE FUNCTION public.admin_daily_series(p_days INTEGER DEFAULT 30) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER := GREATEST(7, LEAST(COALESCE(p_days, 30), 120));
  today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::DATE;
  days JSONB; depth JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'day', g.d,
      'new_users', (SELECT COUNT(*) FROM public.users u WHERE (u.created_at AT TIME ZONE 'Asia/Kolkata')::DATE = g.d),
      'active_people', (SELECT COUNT(DISTINCT x.user_id) FROM (
          SELECT user_id FROM public.daily_logs WHERE log_date = g.d
          UNION SELECT user_id FROM public.daily_checkins WHERE log_date = g.d) x),
      'food_logs', (SELECT COUNT(*) FROM public.daily_logs WHERE log_date = g.d),
      'checkins', (SELECT COUNT(*) FROM public.daily_checkins WHERE log_date = g.d),
      'avg_calorie_adherence', (SELECT ROUND(AVG(calorie_adherence), 1) FROM public.daily_adherence WHERE day = g.d AND calorie_adherence IS NOT NULL),
      'avg_protein_adherence', (SELECT ROUND(AVG(protein_adherence), 1) FROM public.daily_adherence WHERE day = g.d AND protein_adherence IS NOT NULL)
    ) ORDER BY g.d), '[]'::jsonb)
  INTO days
  FROM (SELECT (today - (n - 1) + i)::DATE AS d FROM generate_series(0, n - 1) i) g;
  -- people by how many of the last 7 days they logged food (0 to 7)
  SELECT jsonb_agg(jsonb_build_object('days_logged', k, 'people', COALESCE(c.people, 0)) ORDER BY k)
  INTO depth
  FROM generate_series(0, 7) k
  LEFT JOIN (SELECT dl, COUNT(*) AS people FROM (
      SELECT u.id, COUNT(DISTINCT l.log_date) AS dl FROM public.users u
      LEFT JOIN public.daily_logs l ON l.user_id = u.id AND l.log_date > today - 7 AND l.log_date <= today GROUP BY u.id) z GROUP BY dl) c ON c.dl = k;
  RETURN jsonb_build_object('days', n, 'series', days, 'depth_7d', depth);
END $$;
REVOKE ALL ON FUNCTION public.admin_daily_series(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_daily_series(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.coach_client_series(p_days INTEGER DEFAULT 14, p_client UUID DEFAULT NULL)
RETURNS TABLE (client_id UUID, day DATE, calories NUMERIC, protein_g NUMERIC, items INTEGER, target_cal INTEGER, target_protein INTEGER, energy NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH win AS (
    SELECT LEAST(GREATEST(COALESCE(p_days, 14), 3), 31) AS n, (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
  ),
  rel AS (
    SELECT r.client_id, r.share_scope FROM public.coach_client_relationships r
    WHERE r.coach_id = (SELECT auth.uid()) AND r.status = 'active' AND r.client_id IS NOT NULL
      AND COALESCE((r.share_scope->>'food')::boolean, FALSE)
      AND (p_client IS NULL OR r.client_id = p_client)
      AND EXISTS (SELECT 1 FROM public.coach_profiles c WHERE c.user_id = r.coach_id AND c.status = 'active')
  )
  SELECT rel.client_id, g.d::date,
         COALESCE(m.calories, 0), COALESCE(m.protein_g, 0), COALESCE(m.items, 0),
         a.target_cal, a.target_protein,
         CASE WHEN COALESCE((rel.share_scope->>'energy')::boolean, FALSE) THEN
           (SELECT ROUND(AVG(CASE e.level WHEN 'low' THEN 1 WHEN 'steady' THEN 2 ELSE 3 END), 2) FROM public.energy_logs e WHERE e.user_id = rel.client_id AND e.log_date = g.d::date)
         END
  FROM rel CROSS JOIN win
  CROSS JOIN LATERAL generate_series(win.today - (win.n - 1), win.today, interval '1 day') AS g(d)
  LEFT JOIN public.daily_nutrition_metrics m ON m.user_id = rel.client_id AND m.day = g.d::date
  LEFT JOIN public.daily_adherence a ON a.user_id = rel.client_id AND a.day = g.d::date
  ORDER BY rel.client_id, g.d
  LIMIT 20000;
$$;
GRANT EXECUTE ON FUNCTION public.coach_client_series(INTEGER, UUID) TO authenticated;
