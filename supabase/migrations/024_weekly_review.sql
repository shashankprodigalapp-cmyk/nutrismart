-- NutriSmart 2.0 / Phase 7: weekly metrics and AI weekly reviews. Additive.
-- Numbers are computed here (deterministic). The AI only words them; every review keeps its evidence.

CREATE TABLE IF NOT EXISTS public.weekly_metrics (
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,                 -- Monday, IST
  days_elapsed INTEGER NOT NULL,            -- 1..7 (less than 7 while the week is running)
  days_logged INTEGER NOT NULL DEFAULT 0,
  avg_calories NUMERIC(7,1), avg_protein NUMERIC(6,1), avg_carbs NUMERIC(6,1), avg_fat NUMERIC(6,1),  -- per logged day
  calorie_adherence NUMERIC(5,1), protein_adherence NUMERIC(5,1), macro_adherence NUMERIC(5,1),
  logging_adherence NUMERIC(5,1), checkin_adherence NUMERIC(5,1), flexible_adherence NUMERIC(5,1),
  energy_checkins INTEGER NOT NULL DEFAULT 0, energy_avg NUMERIC(4,2),   -- 1 low, 2 steady, 3 high
  water_avg NUMERIC(4,1),
  flexible_planned INTEGER NOT NULL DEFAULT 0, flexible_consumed INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, week_start)
);

CREATE OR REPLACE FUNCTION public.compute_weekly_metrics(p_user UUID, p_week_start DATE) RETURNS public.weekly_metrics
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_end DATE := LEAST(p_week_start + 6, v_today);
  v_n INT := GREATEST(1, LEAST(7, (LEAST(p_week_start + 6, v_today) - p_week_start) + 1));
  r public.weekly_metrics;
BEGIN
  -- make sure each day in the window has its daily row (cheap; usually already there)
  PERFORM public.compute_adherence_day(p_user, d::date) FROM generate_series(p_week_start, v_end, interval '1 day') d
    WHERE NOT EXISTS (SELECT 1 FROM public.daily_adherence a WHERE a.user_id = p_user AND a.day = d::date);

  INSERT INTO public.weekly_metrics AS w (user_id, week_start, days_elapsed, days_logged, avg_calories, avg_protein, avg_carbs, avg_fat,
      calorie_adherence, protein_adherence, macro_adherence, logging_adherence, checkin_adherence, flexible_adherence,
      energy_checkins, energy_avg, water_avg, flexible_planned, flexible_consumed, computed_at)
  SELECT p_user, p_week_start, v_n,
    COALESCE((SELECT COUNT(*) FROM public.daily_nutrition_metrics m WHERE m.user_id = p_user AND m.day BETWEEN p_week_start AND v_end AND m.items > 0), 0),
    (SELECT ROUND(AVG(calories),1) FROM public.daily_nutrition_metrics m WHERE m.user_id = p_user AND m.day BETWEEN p_week_start AND v_end AND m.items > 0),
    (SELECT ROUND(AVG(protein_g),1) FROM public.daily_nutrition_metrics m WHERE m.user_id = p_user AND m.day BETWEEN p_week_start AND v_end AND m.items > 0),
    (SELECT ROUND(AVG(carbs_g),1) FROM public.daily_nutrition_metrics m WHERE m.user_id = p_user AND m.day BETWEEN p_week_start AND v_end AND m.items > 0),
    (SELECT ROUND(AVG(fat_g),1) FROM public.daily_nutrition_metrics m WHERE m.user_id = p_user AND m.day BETWEEN p_week_start AND v_end AND m.items > 0),
    (SELECT ROUND(AVG(calorie_adherence),1) FROM public.daily_adherence a WHERE a.user_id = p_user AND a.day BETWEEN p_week_start AND v_end),
    (SELECT ROUND(AVG(protein_adherence),1) FROM public.daily_adherence a WHERE a.user_id = p_user AND a.day BETWEEN p_week_start AND v_end),
    (SELECT ROUND(AVG(macro_adherence),1) FROM public.daily_adherence a WHERE a.user_id = p_user AND a.day BETWEEN p_week_start AND v_end),
    ROUND((SELECT COUNT(*) FROM public.daily_adherence a WHERE a.user_id = p_user AND a.day BETWEEN p_week_start AND v_end AND a.logging_adherence >= 100)::numeric / v_n * 100, 1),
    ROUND((SELECT COUNT(*) FROM public.daily_adherence a WHERE a.user_id = p_user AND a.day BETWEEN p_week_start AND v_end AND a.checkin_adherence >= 100)::numeric / v_n * 100, 1),
    (SELECT ROUND(AVG(flexible_adherence),1) FROM public.daily_adherence a WHERE a.user_id = p_user AND a.day BETWEEN p_week_start AND v_end),
    (SELECT COUNT(*) FROM public.energy_logs e WHERE e.user_id = p_user AND e.log_date BETWEEN p_week_start AND v_end),
    (SELECT ROUND(AVG(CASE e.level WHEN 'low' THEN 1 WHEN 'steady' THEN 2 ELSE 3 END),2) FROM public.energy_logs e WHERE e.user_id = p_user AND e.log_date BETWEEN p_week_start AND v_end),
    (SELECT ROUND(AVG(glasses),1) FROM public.water_logs x WHERE x.user_id = p_user AND x.log_date BETWEEN p_week_start AND v_end),
    (SELECT COUNT(*) FROM public.flexible_meals f WHERE f.user_id = p_user AND f.planned_for BETWEEN p_week_start AND v_end AND f.status IN ('planned','consumed','skipped')),
    (SELECT COUNT(*) FROM public.flexible_meals f WHERE f.user_id = p_user AND f.planned_for BETWEEN p_week_start AND v_end AND f.status = 'consumed'),
    NOW()
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    days_elapsed = EXCLUDED.days_elapsed, days_logged = EXCLUDED.days_logged, avg_calories = EXCLUDED.avg_calories, avg_protein = EXCLUDED.avg_protein,
    avg_carbs = EXCLUDED.avg_carbs, avg_fat = EXCLUDED.avg_fat, calorie_adherence = EXCLUDED.calorie_adherence, protein_adherence = EXCLUDED.protein_adherence,
    macro_adherence = EXCLUDED.macro_adherence, logging_adherence = EXCLUDED.logging_adherence, checkin_adherence = EXCLUDED.checkin_adherence,
    flexible_adherence = EXCLUDED.flexible_adherence, energy_checkins = EXCLUDED.energy_checkins, energy_avg = EXCLUDED.energy_avg, water_avg = EXCLUDED.water_avg,
    flexible_planned = EXCLUDED.flexible_planned, flexible_consumed = EXCLUDED.flexible_consumed, computed_at = NOW()
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.compute_weekly_metrics(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_weekly_metrics(UUID, DATE) TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_weekly_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  data_hash   TEXT NOT NULL,                    -- hash of the facts; same facts = reuse, no new AI call
  source      TEXT NOT NULL CHECK (source IN ('ai','rules')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','edited','rejected')),
  visible_to_client BOOLEAN NOT NULL DEFAULT FALSE,
  facts       JSONB NOT NULL DEFAULT '[]',      -- the numbers, with ids
  sections    JSONB NOT NULL DEFAULT '{}',      -- what the review says; each item cites fact ids
  edited_sections JSONB,
  model       TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by  UUID, decided_at TIMESTAMPTZ,
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_awr_user ON public.ai_weekly_reviews (user_id, week_start DESC);

CREATE TABLE IF NOT EXISTS public.ai_insights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  review_id   UUID REFERENCES public.ai_weekly_reviews(id) ON DELETE CASCADE,
  insight     TEXT NOT NULL,
  evidence    JSONB NOT NULL,                   -- [{fact_id, metric, text}]
  source_metric TEXT NOT NULL,
  period_start DATE, period_end DATE,
  confidence  TEXT NOT NULL DEFAULT 'early' CHECK (confidence IN ('insufficient','early','emerging','repeated')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_user ON public.ai_insights (user_id, generated_at DESC);

ALTER TABLE public.weekly_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_weekly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wm_read ON public.weekly_metrics;
CREATE POLICY wm_read ON public.weekly_metrics FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_coach_of(user_id, 'food'));
-- A person with a coach sees a review only after the coach approves it; a person without a coach sees it at once.
DROP POLICY IF EXISTS awr_owner_read ON public.ai_weekly_reviews;
CREATE POLICY awr_owner_read ON public.ai_weekly_reviews FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND visible_to_client AND status <> 'rejected');
DROP POLICY IF EXISTS awr_coach_read ON public.ai_weekly_reviews;
CREATE POLICY awr_coach_read ON public.ai_weekly_reviews FOR SELECT TO authenticated USING (public.is_coach_of(user_id, 'food'));
DROP POLICY IF EXISTS ai_insights_read ON public.ai_insights;
CREATE POLICY ai_insights_read ON public.ai_insights FOR SELECT TO authenticated
  USING (public.is_coach_of(user_id, 'food') OR (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.ai_weekly_reviews r WHERE r.id = ai_insights.review_id AND r.visible_to_client AND r.status <> 'rejected')));

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('v2_weekly_review', FALSE, 'Weekly review screens (2.0)'),
  ('v2_ai_reviews', FALSE, 'Use AI wording for reviews; off = plain rule-based wording')
ON CONFLICT (key) DO NOTHING;
