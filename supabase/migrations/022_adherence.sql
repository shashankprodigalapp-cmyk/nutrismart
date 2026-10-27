-- NutriSmart 2.0 / Phase 5: stored daily nutrition metrics and adherence. Additive. All maths is here, in one place.
-- Scoring (0-100, no AI):
--   calorie_adherence : 100 when within 10% of target; falls in a straight line to 0 at 50% below or 50% above.
--   protein_adherence : protein / target, capped at 100 (more protein than target is not penalised).
--   fat_adherence     : same band rule as calories, around the fat target.
--   macro_adherence   : average of protein and fat scores (the ones that have a target).
--   logging_adherence : 100 if anything was logged that day, else 0.
--   checkin_adherence : 100 if an energy check-in was given that day, else 0.
-- Days with nothing logged have NULL calorie/protein/macro scores (missing data is shown as missing, not as a failure).

CREATE OR REPLACE FUNCTION public.band_score(p_ratio NUMERIC) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_ratio IS NULL THEN NULL
    WHEN p_ratio BETWEEN 0.9 AND 1.1 THEN 100
    WHEN p_ratio <= 0.5 OR p_ratio >= 1.5 THEN 0
    WHEN p_ratio < 0.9 THEN ROUND(((p_ratio - 0.5) / 0.4) * 100, 1)
    ELSE ROUND(((1.5 - p_ratio) / 0.4) * 100, 1)
  END;
$$;

CREATE TABLE IF NOT EXISTS public.daily_nutrition_metrics (
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  calories  NUMERIC(7,1) NOT NULL DEFAULT 0,
  protein_g NUMERIC(6,1) NOT NULL DEFAULT 0,
  carbs_g   NUMERIC(6,1) NOT NULL DEFAULT 0,
  fat_g     NUMERIC(6,1) NOT NULL DEFAULT 0,
  items     INTEGER NOT NULL DEFAULT 0,
  meals     INTEGER NOT NULL DEFAULT 0,
  water_glasses INTEGER,
  energy_checkins INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS public.daily_adherence (
  user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  target_cal     INTEGER,
  target_protein INTEGER,
  target_fat     INTEGER,
  calorie_adherence NUMERIC(5,1),
  protein_adherence NUMERIC(5,1),
  fat_adherence     NUMERIC(5,1),
  macro_adherence   NUMERIC(5,1),
  logging_adherence NUMERIC(5,1) NOT NULL DEFAULT 0,
  checkin_adherence NUMERIC(5,1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_adherence_day ON public.daily_adherence (day);

-- Recompute one person-day from the raw logs. Safe to call any number of times.
CREATE OR REPLACE FUNCTION public.compute_adherence_day(p_user UUID, p_day DATE) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cal NUMERIC; v_pro NUMERIC; v_carb NUMERIC; v_fat NUMERIC; v_items INT; v_meals INT; v_water INT; v_chk INT;
  v_tcal INT; v_tpro INT; v_tfat INT;
  v_ca NUMERIC; v_pa NUMERIC; v_fa NUMERIC; v_ma NUMERIC;
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

  INSERT INTO public.daily_nutrition_metrics (user_id, day, calories, protein_g, carbs_g, fat_g, items, meals, water_glasses, energy_checkins, updated_at)
  VALUES (p_user, p_day, v_cal, v_pro, v_carb, v_fat, v_items, v_meals, v_water, v_chk, NOW())
  ON CONFLICT (user_id, day) DO UPDATE SET calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g,
    fat_g = EXCLUDED.fat_g, items = EXCLUDED.items, meals = EXCLUDED.meals, water_glasses = EXCLUDED.water_glasses,
    energy_checkins = EXCLUDED.energy_checkins, updated_at = NOW();

  INSERT INTO public.daily_adherence (user_id, day, target_cal, target_protein, target_fat, calorie_adherence, protein_adherence, fat_adherence,
                                      macro_adherence, logging_adherence, checkin_adherence, updated_at)
  VALUES (p_user, p_day, v_tcal, v_tpro, v_tfat, v_ca, v_pa, v_fa, v_ma,
          CASE WHEN v_items > 0 THEN 100 ELSE 0 END, CASE WHEN v_chk > 0 THEN 100 ELSE 0 END, NOW())
  ON CONFLICT (user_id, day) DO UPDATE SET target_cal = EXCLUDED.target_cal, target_protein = EXCLUDED.target_protein,
    target_fat = EXCLUDED.target_fat, calorie_adherence = EXCLUDED.calorie_adherence, protein_adherence = EXCLUDED.protein_adherence,
    fat_adherence = EXCLUDED.fat_adherence, macro_adherence = EXCLUDED.macro_adherence, logging_adherence = EXCLUDED.logging_adherence,
    checkin_adherence = EXCLUDED.checkin_adherence, updated_at = NOW();
END $$;

-- Keep the stored numbers fresh on every log change. Never allowed to block a log.
CREATE OR REPLACE FUNCTION public.adherence_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN PERFORM public.compute_adherence_day(OLD.user_id, OLD.log_date);
    ELSE
      PERFORM public.compute_adherence_day(NEW.user_id, NEW.log_date);
      IF TG_OP = 'UPDATE' AND OLD.log_date IS DISTINCT FROM NEW.log_date THEN PERFORM public.compute_adherence_day(OLD.user_id, OLD.log_date); END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_adherence_daily_logs ON public.daily_logs;
CREATE TRIGGER trg_adherence_daily_logs AFTER INSERT OR UPDATE OR DELETE ON public.daily_logs FOR EACH ROW EXECUTE FUNCTION public.adherence_trigger();
DROP TRIGGER IF EXISTS trg_adherence_energy_logs ON public.energy_logs;
CREATE TRIGGER trg_adherence_energy_logs AFTER INSERT OR UPDATE OR DELETE ON public.energy_logs FOR EACH ROW EXECUTE FUNCTION public.adherence_trigger();
DROP TRIGGER IF EXISTS trg_adherence_water_logs ON public.water_logs;
CREATE TRIGGER trg_adherence_water_logs AFTER INSERT OR UPDATE OR DELETE ON public.water_logs FOR EACH ROW EXECUTE FUNCTION public.adherence_trigger();

-- Backfill the last 60 days for everyone who has logged anything (one-time; safe to re-run).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT user_id, log_date FROM public.daily_logs WHERE log_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 60 LOOP
    PERFORM public.compute_adherence_day(r.user_id, r.log_date);
  END LOOP;
END $$;

-- Reading: a person reads their own; a coach reads shared food data only.
ALTER TABLE public.daily_nutrition_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_adherence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dnm_read ON public.daily_nutrition_metrics;
CREATE POLICY dnm_read ON public.daily_nutrition_metrics FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_coach_of(user_id, 'food'));
DROP POLICY IF EXISTS da_read ON public.daily_adherence;
CREATE POLICY da_read ON public.daily_adherence FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_coach_of(user_id, 'food'));
REVOKE ALL ON FUNCTION public.compute_adherence_day(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_adherence_day(UUID, DATE) TO service_role;
