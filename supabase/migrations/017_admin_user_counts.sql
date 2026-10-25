-- 017: Users tab shows the real AI counts (search + photo, including the profile bonus).
CREATE OR REPLACE FUNCTION public.get_users_for_admin(
  p_calling_admin_id UUID,
  p_search           TEXT    DEFAULT NULL,
  p_plan_filter      TEXT    DEFAULT NULL,
  p_limit            INTEGER DEFAULT 50,
  p_offset           INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_day    TIMESTAMPTZ := (((NOW() AT TIME ZONE 'Asia/Kolkata')::DATE)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT jsonb_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      u.id, u.email, u.name, u.plan, u.created_at,
      s.status AS sub_status, s.valid_until, s.payment_source, s.gifted_by, s.admin_note,
      COALESCE((SELECT r.count FROM public.rate_limits r WHERE r.user_id = u.id AND r.window_start = v_day), 0) AS ai_searches_today,
      COALESCE((SELECT r.count FROM public.rate_limits r WHERE r.user_id = u.id AND r.window_start = v_day + INTERVAL '1 second'), 0) AS photo_searches_today,
      CASE WHEN u.plan = 'pro' THEN 200
           WHEN EXISTS (SELECT 1 FROM public.user_profile p WHERE p.user_id = u.id AND p.completed_at IS NOT NULL) THEN 10
           ELSE 5 END AS ai_limit
    FROM public.users u
    LEFT JOIN public.subscriptions s ON s.user_id = u.id
    WHERE
      (p_search IS NULL OR u.email ILIKE '%' || p_search || '%' OR u.name ILIKE '%' || p_search || '%')
      AND (p_plan_filter IS NULL OR u.plan = p_plan_filter)
    ORDER BY u.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;
