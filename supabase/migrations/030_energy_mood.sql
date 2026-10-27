-- NutriSmart 2.0 / Phase 13: morning check-in and after-meal feelings. Additive.
-- Existing energy_logs (post-meal low/steady/high) are untouched. These tables add mood, sleep, stress, hunger and fullness.
-- Sharing: a coach can read them only when the client's "mood" switch is on.

CREATE TABLE IF NOT EXISTS public.daily_checkins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  log_date   DATE NOT NULL,
  energy     SMALLINT CHECK (energy BETWEEN 1 AND 5),
  mood       SMALLINT CHECK (mood BETWEEN 1 AND 5),
  hunger     SMALLINT CHECK (hunger BETWEEN 1 AND 5),
  sleep      TEXT CHECK (sleep IN ('poor','okay','good')),
  stress     TEXT CHECK (stress IN ('low','medium','high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, log_date),
  CHECK (energy IS NOT NULL OR mood IS NOT NULL OR hunger IS NOT NULL OR sleep IS NOT NULL OR stress IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_daily_checkins_user ON public.daily_checkins (user_id, log_date DESC);

CREATE TABLE IF NOT EXISTS public.meal_feelings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  log_date      DATE NOT NULL,
  meal          TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','snack','dinner')),
  energy_change TEXT CHECK (energy_change IN ('better','same','lower')),
  fullness      TEXT CHECK (fullness IN ('hungry','comfortable','full')),
  mood_change   TEXT CHECK (mood_change IN ('better','same','lower')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, log_date, meal),
  CHECK (energy_change IS NOT NULL OR fullness IS NOT NULL OR mood_change IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_meal_feelings_user ON public.meal_feelings (user_id, log_date DESC);

ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_feelings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_own ON public.daily_checkins;
CREATE POLICY dc_own ON public.daily_checkins FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS dc_coach ON public.daily_checkins;
CREATE POLICY dc_coach ON public.daily_checkins FOR SELECT TO authenticated USING (public.is_coach_of(user_id, 'mood'));
DROP POLICY IF EXISTS mf_own ON public.meal_feelings;
CREATE POLICY mf_own ON public.meal_feelings FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS mf_coach ON public.meal_feelings;
CREATE POLICY mf_coach ON public.meal_feelings FOR SELECT TO authenticated USING (public.is_coach_of(user_id, 'mood'));

-- Timeline lines (one per check-in; edits update the same line). Failures never block saving.
CREATE OR REPLACE FUNCTION public.tl_from_daily_checkins() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
    VALUES (NEW.user_id, 'checkin_logged', 'mood', NEW.created_at, 'daily_checkins', NEW.id::text,
            jsonb_build_object('log_date', NEW.log_date, 'energy', NEW.energy, 'mood', NEW.mood, 'hunger', NEW.hunger, 'sleep', NEW.sleep, 'stress', NEW.stress),
            'daily_checkins:' || NEW.id)
    ON CONFLICT (user_id, idempotency_key) DO UPDATE SET payload = EXCLUDED.payload;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tl_daily_checkins ON public.daily_checkins;
CREATE TRIGGER trg_tl_daily_checkins AFTER INSERT OR UPDATE ON public.daily_checkins FOR EACH ROW EXECUTE FUNCTION public.tl_from_daily_checkins();

CREATE OR REPLACE FUNCTION public.tl_from_meal_feelings() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
    VALUES (NEW.user_id, 'meal_feeling', 'mood', NEW.created_at, 'meal_feelings', NEW.id::text,
            jsonb_build_object('log_date', NEW.log_date, 'meal', NEW.meal, 'energy_change', NEW.energy_change, 'fullness', NEW.fullness, 'mood_change', NEW.mood_change),
            'meal_feelings:' || NEW.id)
    ON CONFLICT (user_id, idempotency_key) DO UPDATE SET payload = EXCLUDED.payload;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tl_meal_feelings ON public.meal_feelings;
CREATE TRIGGER trg_tl_meal_feelings AFTER INSERT OR UPDATE ON public.meal_feelings FOR EACH ROW EXECUTE FUNCTION public.tl_from_meal_feelings();

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('v2_checkins', FALSE, 'Morning check-in and Energy and mood page (2.0)'),
  ('v2_mood_insights', FALSE, 'Show personal energy and mood insights (2.0)')
ON CONFLICT (key) DO NOTHING;
