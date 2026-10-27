-- NutriSmart 2.0 / Phase 6: flexible (planned) meals. Additive.
-- The plan numbers come from deterministic code (src/lib/flexibleMeal.ts); the snapshot is stored so a plan can be explained later.

CREATE TABLE IF NOT EXISTS public.flexible_meals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  planned_for   DATE NOT NULL,
  planned_time  TEXT CHECK (planned_time IS NULL OR planned_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  label         TEXT CHECK (char_length(label) <= 60),
  reserved_kcal INTEGER NOT NULL CHECK (reserved_kcal BETWEEN 100 AND 3000),
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','consumed','skipped','cancelled')),
  consumed_kcal INTEGER CHECK (consumed_kcal IS NULL OR consumed_kcal BETWEEN 0 AND 6000),
  plan_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flex_user_day ON public.flexible_meals (user_id, planned_for DESC);

CREATE TABLE IF NOT EXISTS public.flexible_meal_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flexible_meal_id UUID NOT NULL REFERENCES public.flexible_meals(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','updated','consumed','skipped','cancelled')),
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flex_events_meal ON public.flexible_meal_events (flexible_meal_id, created_at);

ALTER TABLE public.flexible_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flexible_meal_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flex_own ON public.flexible_meals;
CREATE POLICY flex_own ON public.flexible_meals FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS flex_coach_read ON public.flexible_meals;
CREATE POLICY flex_coach_read ON public.flexible_meals FOR SELECT TO authenticated USING (public.is_coach_of(user_id, 'food'));
DROP POLICY IF EXISTS flex_events_read ON public.flexible_meal_events;
CREATE POLICY flex_events_read ON public.flexible_meal_events FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_coach_of(user_id, 'food'));

-- Every create / status change leaves an event and a timeline line. Never allowed to block the save.
CREATE OR REPLACE FUNCTION public.flex_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type TEXT; v_tl TEXT;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN v_type := 'created'; v_tl := 'flexible_meal_created';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      v_type := NEW.status; v_tl := CASE NEW.status WHEN 'consumed' THEN 'flexible_meal_consumed' ELSE 'flexible_meal_' || NEW.status END;
    ELSE v_type := 'updated'; v_tl := NULL; END IF;
    INSERT INTO public.flexible_meal_events (flexible_meal_id, user_id, event_type, detail)
    VALUES (NEW.id, NEW.user_id, v_type, jsonb_build_object('reserved_kcal', NEW.reserved_kcal, 'consumed_kcal', NEW.consumed_kcal));
    IF v_tl IS NOT NULL THEN
      INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
      VALUES (NEW.user_id, v_tl, 'food', NOW(), 'flexible_meals', NEW.id::text,
              jsonb_build_object('label', NEW.label, 'reserved_kcal', NEW.reserved_kcal, 'consumed_kcal', NEW.consumed_kcal, 'planned_for', NEW.planned_for, 'planned_time', NEW.planned_time),
              'flexible_meals:' || NEW.id || ':' || v_type)
      ON CONFLICT DO NOTHING;
    END IF;
    PERFORM public.compute_adherence_day(NEW.user_id, NEW.planned_for);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_flex ON public.flexible_meals;
CREATE TRIGGER trg_flex AFTER INSERT OR UPDATE ON public.flexible_meals FOR EACH ROW EXECUTE FUNCTION public.flex_trigger();

-- Flexible-meal adherence column and the updated daily calculation.
ALTER TABLE public.daily_adherence ADD COLUMN IF NOT EXISTS flexible_adherence NUMERIC(5,1);
CREATE OR REPLACE FUNCTION public.compute_adherence_day(p_user UUID, p_day DATE) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cal NUMERIC; v_pro NUMERIC; v_carb NUMERIC; v_fat NUMERIC; v_items INT; v_meals INT; v_water INT; v_chk INT;
  v_tcal INT; v_tpro INT; v_tfat INT;
  v_ca NUMERIC; v_pa NUMERIC; v_fa NUMERIC; v_ma NUMERIC; v_fx NUMERIC;
BEGIN
  SELECT COALESCE(SUM(cal),0), COALESCE(SUM(protein),0), COALESCE(SUM(carbs),0), COALESCE(SUM(fat),0),
         COUNT(*), COUNT(DISTINCT meal)
    INTO v_cal, v_pro, v_carb, v_fat, v_items, v_meals
  FROM public.daily_logs WHERE user_id = p_user AND log_date = p_day;
  SELECT glasses INTO v_water FROM public.water_logs WHERE user_id = p_user AND log_date = p_day;
  SELECT COUNT(*) INTO v_chk FROM public.energy_logs WHERE user_id = p_user AND log_date = p_day;

  -- Target in force on that day: newest target that started on or before the day, else the person's own settings.
  SELECT t.calories, t.protein_g, t.fat_g INTO v_tcal, v_tpro, v_tfat
  FROM public.nutrition_targets t
  WHERE t.client_id = p_user AND t.effective_from < ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
  ORDER BY t.effective_from DESC LIMIT 1;
  IF v_tcal IS NULL THEN
    SELECT u.target_cal, u.target_protein, u.target_fat INTO v_tcal, v_tpro, v_tfat FROM public.users u WHERE u.id = p_user;
  END IF;

  IF v_items > 0 THEN
    v_ca := public.band_score(CASE WHEN v_tcal > 0 THEN v_cal / v_tcal END);
    v_pa := CASE WHEN v_tpro > 0 THEN LEAST(ROUND(v_pro / v_tpro * 100, 1), 100) END;
    v_fa := public.band_score(CASE WHEN v_tfat > 0 THEN v_fat / v_tfat END);
    SELECT ROUND(AVG(x), 1) INTO v_ma FROM unnest(ARRAY[v_pa, v_fa]) AS x WHERE x IS NOT NULL;
  END IF;

  -- Flexible meal: judged only when one was planned and eaten that day; skipped or cancelled meals are not held against anyone.
  SELECT public.band_score(CASE WHEN f.reserved_kcal > 0 AND f.consumed_kcal IS NOT NULL THEN f.consumed_kcal::numeric / f.reserved_kcal END)
    INTO v_fx
  FROM public.flexible_meals f
  WHERE f.user_id = p_user AND f.planned_for = p_day AND f.status = 'consumed'
  ORDER BY f.created_at DESC LIMIT 1;

  INSERT INTO public.daily_nutrition_metrics (user_id, day, calories, protein_g, carbs_g, fat_g, items, meals, water_glasses, energy_checkins, updated_at)
  VALUES (p_user, p_day, v_cal, v_pro, v_carb, v_fat, v_items, v_meals, v_water, v_chk, NOW())
  ON CONFLICT (user_id, day) DO UPDATE SET calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g,
    fat_g = EXCLUDED.fat_g, items = EXCLUDED.items, meals = EXCLUDED.meals, water_glasses = EXCLUDED.water_glasses,
    energy_checkins = EXCLUDED.energy_checkins, updated_at = NOW();

  INSERT INTO public.daily_adherence (user_id, day, target_cal, target_protein, target_fat, calorie_adherence, protein_adherence, fat_adherence,
                                      macro_adherence, flexible_adherence, logging_adherence, checkin_adherence, updated_at)
  VALUES (p_user, p_day, v_tcal, v_tpro, v_tfat, v_ca, v_pa, v_fa, v_ma, v_fx,
          CASE WHEN v_items > 0 THEN 100 ELSE 0 END, CASE WHEN v_chk > 0 THEN 100 ELSE 0 END, NOW())
  ON CONFLICT (user_id, day) DO UPDATE SET target_cal = EXCLUDED.target_cal, target_protein = EXCLUDED.target_protein,
    target_fat = EXCLUDED.target_fat, calorie_adherence = EXCLUDED.calorie_adherence, protein_adherence = EXCLUDED.protein_adherence,
    fat_adherence = EXCLUDED.fat_adherence, macro_adherence = EXCLUDED.macro_adherence, flexible_adherence = EXCLUDED.flexible_adherence, logging_adherence = EXCLUDED.logging_adherence,
    checkin_adherence = EXCLUDED.checkin_adherence, updated_at = NOW();
END $$;
REVOKE ALL ON FUNCTION public.compute_adherence_day(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_adherence_day(UUID, DATE) TO service_role;

-- timeline scope list already allows 'food'; allow longer event type names are fine (<= 60 chars).
