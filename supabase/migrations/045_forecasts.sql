-- 045: Predictive insights (P8). Five forecasts, each with its own switch. Additive only.
-- Forecasts are plain arithmetic on the person's own logs (no AI), stored with their evidence, confidence, sample size and expiry.
-- The browser can only READ its own rows; the server (service role) writes. A coach reads a client's forecasts through the server, never from this table.

CREATE TABLE IF NOT EXISTS public.forecasts (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key           TEXT NOT NULL CHECK (key IN ('week_landing','hard_weekdays','energy_patterns','lapse_risk','protein_catchup')),
  version       INT  NOT NULL DEFAULT 1,
  status        TEXT NOT NULL CHECK (status IN ('ready','insufficient')),
  confidence    TEXT NOT NULL CHECK (confidence IN ('none','low','medium','high')),
  headline      TEXT NOT NULL,
  evidence      JSONB NOT NULL DEFAULT '[]'::jsonb,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_size   INT  NOT NULL DEFAULT 0,
  min_needed    INT  NOT NULL DEFAULT 0,
  input_hash    TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Only changes are kept here (one row each time an answer changes), so the table stays small. Pruned to 90 days by the server.
CREATE TABLE IF NOT EXISTS public.forecast_history (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  status        TEXT NOT NULL,
  confidence    TEXT NOT NULL,
  headline      TEXT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS forecast_history_user_time ON public.forecast_history (user_id, calculated_at DESC);

ALTER TABLE public.forecasts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fc_own_read  ON public.forecasts;
DROP POLICY IF EXISTS fch_own_read ON public.forecast_history;
CREATE POLICY fc_own_read  ON public.forecasts        FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY fch_own_read ON public.forecast_history FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
-- No INSERT / UPDATE / DELETE policies: only the server writes.

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('forecast_week_landing',   FALSE, 'P8 Forecast 1: where the week is heading'),
  ('forecast_hard_weekdays',  FALSE, 'P8 Forecast 2: which weekdays tend to be harder'),
  ('forecast_energy_patterns',FALSE, 'P8 Forecast 3: energy and hunger patterns (stays off until reviewed)'),
  ('forecast_lapse_risk',     FALSE, 'P8 Forecast 4: logging-lapse risk (gentle check-in and coach brief)'),
  ('forecast_protein_catchup',FALSE, 'P8 Forecast 5: protein catch-up for the rest of today')
ON CONFLICT (key) DO NOTHING;
