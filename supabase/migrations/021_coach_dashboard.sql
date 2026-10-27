-- NutriSmart 2.0 / Phase 3: coach dashboard numbers, computed in the database (not in the browser).
-- Additive. Reads only what each client allowed (share_scope). IST days.

CREATE OR REPLACE FUNCTION public.coach_dashboard(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  relationship_id UUID, client_id UUID, client_name TEXT, link_status TEXT, share_scope JSONB,
  goal_type TEXT, target_cal INTEGER, target_protein INTEGER,
  days_in_window INTEGER, days_logged INTEGER, avg_cal NUMERIC, avg_protein NUMERIC,
  energy_checkins INTEGER, energy_avg NUMERIC, energy_prev_avg NUMERIC,
  last_activity TIMESTAMPTZ, accepted_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT (SELECT auth.uid()) AS uid),
  win AS (
    SELECT LEAST(GREATEST(COALESCE(p_days, 7), 1), 31) AS n,
           (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
  ),
  rel AS (
    SELECT r.id, r.client_id, r.status, r.share_scope, r.accepted_at
    FROM public.coach_client_relationships r, me
    WHERE r.coach_id = me.uid AND r.status IN ('active','paused') AND r.client_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.coach_profiles c WHERE c.user_id = r.coach_id AND c.status = 'active')
  ),
  food AS (
    SELECT d.user_id, d.log_date, SUM(d.cal) AS cal, SUM(d.protein) AS protein
    FROM public.daily_logs d, win, rel
    WHERE d.user_id = rel.client_id AND rel.status = 'active' AND COALESCE((rel.share_scope->>'food')::boolean, FALSE)
      AND d.log_date > win.today - win.n AND d.log_date <= win.today
    GROUP BY d.user_id, d.log_date
  ),
  foodsum AS (
    SELECT user_id, COUNT(*)::int AS days_logged, AVG(cal) AS avg_cal, AVG(protein) AS avg_protein FROM food GROUP BY user_id
  ),
  en AS (
    SELECT e.user_id,
           COUNT(*) FILTER (WHERE e.log_date > win.today - win.n)::int AS cur_n,
           AVG(CASE e.level WHEN 'low' THEN 1 WHEN 'steady' THEN 2 ELSE 3 END) FILTER (WHERE e.log_date > win.today - win.n) AS cur_avg,
           AVG(CASE e.level WHEN 'low' THEN 1 WHEN 'steady' THEN 2 ELSE 3 END) FILTER (WHERE e.log_date <= win.today - win.n) AS prev_avg
    FROM public.energy_logs e, win, rel
    WHERE e.user_id = rel.client_id AND rel.status = 'active' AND COALESCE((rel.share_scope->>'energy')::boolean, FALSE)
      AND e.log_date > win.today - 2 * win.n AND e.log_date <= win.today
    GROUP BY e.user_id
  ),
  act AS (
    SELECT rel.client_id AS user_id,
           GREATEST(
             (SELECT MAX(d.created_at) FROM public.daily_logs d WHERE d.user_id = rel.client_id AND COALESCE((rel.share_scope->>'food')::boolean, FALSE)),
             (SELECT MAX(e.log_time) FROM public.energy_logs e WHERE e.user_id = rel.client_id AND COALESCE((rel.share_scope->>'energy')::boolean, FALSE))
           ) AS last_activity
    FROM rel WHERE rel.status = 'active'
  )
  SELECT rel.id, rel.client_id, COALESCE(NULLIF(u.name, ''), 'Client'), rel.status, rel.share_scope,
         cp.goal_type,
         COALESCE(nt.calories, u.target_cal), COALESCE(nt.protein_g, u.target_protein),
         win.n, fs.days_logged, ROUND(fs.avg_cal, 0), ROUND(fs.avg_protein, 1),
         en.cur_n, ROUND(en.cur_avg, 2), ROUND(en.prev_avg, 2),
         act.last_activity, rel.accepted_at
  FROM rel
  CROSS JOIN win
  JOIN public.users u ON u.id = rel.client_id
  LEFT JOIN public.client_profiles cp ON cp.user_id = rel.client_id
  LEFT JOIN LATERAL (
    SELECT t.calories, t.protein_g FROM public.nutrition_targets t
    WHERE t.client_id = rel.client_id AND t.effective_to IS NULL ORDER BY t.effective_from DESC LIMIT 1
  ) nt ON TRUE
  LEFT JOIN foodsum fs ON fs.user_id = rel.client_id
  LEFT JOIN en ON en.user_id = rel.client_id
  LEFT JOIN act ON act.user_id = rel.client_id
  ORDER BY rel.accepted_at DESC NULLS LAST
  LIMIT 500;
$$;
GRANT EXECUTE ON FUNCTION public.coach_dashboard(INTEGER) TO authenticated;
