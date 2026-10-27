-- NutriSmart 2.0 / Phase 15: personal experiments. Additive.
-- A person picks a small set of steps, tries them for 7 to 28 days, and compares how they felt before and during.
-- They own the experiment. A coach can read it only when the client's "mood" sharing switch is on.

CREATE TABLE IF NOT EXISTS public.experiments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  template      TEXT NOT NULL CHECK (char_length(template) BETWEEN 1 AND 40),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  actions       JSONB NOT NULL CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 6),
  metrics       JSONB NOT NULL CHECK (jsonb_typeof(metrics) = 'array' AND jsonb_array_length(metrics) BETWEEN 1 AND 6),
  start_date    DATE NOT NULL,
  duration_days SMALLINT NOT NULL CHECK (duration_days BETWEEN 3 AND 28),
  baseline_days SMALLINT NOT NULL DEFAULT 7 CHECK (baseline_days BETWEEN 3 AND 14),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  result        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_experiments_user ON public.experiments (user_id, start_date DESC);
-- one running experiment at a time keeps the comparison clean
CREATE UNIQUE INDEX IF NOT EXISTS uq_experiments_one_active ON public.experiments (user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.experiment_days (
  experiment_id UUID NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  done          JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(done) = 'array' AND jsonb_array_length(done) <= 6),   -- indexes of the steps done that day
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (experiment_id, day)
);

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exp_own ON public.experiments;
CREATE POLICY exp_own ON public.experiments FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS exp_coach ON public.experiments;
CREATE POLICY exp_coach ON public.experiments FOR SELECT TO authenticated USING (public.is_coach_of(user_id, 'mood'));
DROP POLICY IF EXISTS expd_own ON public.experiment_days;
CREATE POLICY expd_own ON public.experiment_days FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.experiments e WHERE e.id = experiment_id AND e.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS expd_coach ON public.experiment_days;
CREATE POLICY expd_coach ON public.experiment_days FOR SELECT TO authenticated USING (public.is_coach_of(user_id, 'mood'));

INSERT INTO public.feature_flags (key, enabled, description) VALUES ('v2_experiments', FALSE, 'Personal experiments (2.0)') ON CONFLICT (key) DO NOTHING;
