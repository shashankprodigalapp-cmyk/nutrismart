-- NutriSmart 2.1 / P1, P3, P5: personal feature store, recommendations, generated reports, feature switches.
-- ADDITIVE ONLY. 1.0 does not read any of this. Writes happen only on the server (service role); a person can only read their own rows.

-- ---- Personal feature store: one row per person, feature and window --------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal_features (
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_key   TEXT NOT NULL,
  window_days   SMALLINT NOT NULL CHECK (window_days IN (1, 7, 14, 30, 90)),
  value         NUMERIC(10,2),
  baseline      NUMERIC(10,2),
  delta         NUMERIC(10,2),
  trend         TEXT NOT NULL DEFAULT 'unknown' CHECK (trend IN ('up', 'down', 'flat', 'unknown')),
  sample_size   INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  confidence    TEXT NOT NULL DEFAULT 'none' CHECK (confidence IN ('none', 'low', 'medium', 'high')),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature_key, window_days)
);

-- ---- Recommendations: Reason -> Evidence -> Confidence -> Action -> Expected outcome -> Follow-up ------------------
CREATE TABLE IF NOT EXISTS public.recommendations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rec_type         TEXT NOT NULL CHECK (rec_type IN ('meal_adjustment','food_swap','protein_addition','portion_adjustment','meal_timing','flexible_meal','check_in','behaviour_nudge','coach_review')),
  rec_key          TEXT NOT NULL,
  window_day       DATE NOT NULL,
  reason           TEXT NOT NULL,
  evidence         JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence       TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  action           TEXT NOT NULL,
  expected_outcome TEXT NOT NULL,
  follow_up_at     DATE,
  score            NUMERIC(6,3) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','accepted','dismissed','done','expired')),
  metric           JSONB,          -- {feature, window_days, value, direction}: what we will measure at follow-up
  outcome          JSONB,          -- {result: 'helped'|'no_change', before, after, measured_at}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acted_at         TIMESTAMPTZ,
  UNIQUE (user_id, rec_key, window_day)
);
CREATE INDEX IF NOT EXISTS recommendations_user_idx ON public.recommendations (user_id, created_at DESC);

-- ---- Reports generated from the structured numbers (never invented by the language model) ---------------------------
CREATE TABLE IF NOT EXISTS public.intel_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period       TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly','learning')),
  period_start DATE NOT NULL,
  payload      JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period, period_start)
);

ALTER TABLE public.personal_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_reports     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pf_own_read  ON public.personal_features;
DROP POLICY IF EXISTS rec_own_read ON public.recommendations;
DROP POLICY IF EXISTS ir_own_read  ON public.intel_reports;
CREATE POLICY pf_own_read  ON public.personal_features FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY rec_own_read ON public.recommendations   FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY ir_own_read  ON public.intel_reports     FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
-- No INSERT / UPDATE / DELETE policies: the browser cannot write these tables. The server (service role) does.

-- ---- Feature switches (all OFF by default). Existing switches are reused: v2_coach, v2_attention, v2_weekly_review, v2_monthly_review, v2_experiments, v2_plans.
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('analytics_engine',    FALSE, '2.1 Personal feature store and rolling analytics'),
  ('personal_model',      FALSE, '2.1 What NutriSmart learned about the person'),
  ('recommendations',     FALSE, '2.1 Personal recommendations with reason, evidence and follow-up'),
  ('daily_intelligence',  FALSE, '2.1 New Today signal: what matters, what to do next, smart meal'),
  ('adaptive_meal_plan',  FALSE, '2.1 Smart meal that fits the rest of the day'),
  ('weekly_reports',      FALSE, '2.1 Generated weekly report'),
  ('monthly_reports',     FALSE, '2.1 Generated monthly report'),
  ('energy_intelligence', FALSE, '2.1 Hunger, fullness and digestion check-ins and observations')
ON CONFLICT (key) DO NOTHING;
