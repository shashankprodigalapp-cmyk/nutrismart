-- NutriSmart 2.0 / Phase 9: Needs Attention. Additive.
-- The signals themselves are worked out live from the coach dashboard numbers (deterministic rules in coachMetrics.ts),
-- so they can never be stale or invented. This table stores only what a coach DID about a signal: snooze or dismiss.

CREATE TABLE IF NOT EXISTS public.attention_actions (
  coach_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signal     TEXT NOT NULL CHECK (signal IN ('logging_decline','logging_stopped','protein_deviation','calorie_deviation','energy_decline')),
  action     TEXT NOT NULL CHECK (action IN ('snoozed','dismissed')),
  severity   TEXT NOT NULL CHECK (severity IN ('attention','drifting')),   -- severity when the coach acted
  until_at   TIMESTAMPTZ,                                                 -- snooze end; NULL for dismiss
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (coach_id, client_id, signal),
  CHECK ((action = 'snoozed' AND until_at IS NOT NULL) OR (action = 'dismissed' AND until_at IS NULL))
);

ALTER TABLE public.attention_actions ENABLE ROW LEVEL SECURITY;
-- A coach reads only their own actions. Writes go through the server (it checks the coach-client link first).
DROP POLICY IF EXISTS attention_actions_read ON public.attention_actions;
CREATE POLICY attention_actions_read ON public.attention_actions FOR SELECT TO authenticated USING (coach_id = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.attention_actions FROM authenticated, anon;

INSERT INTO public.feature_flags (key, enabled, description) VALUES ('v2_attention', FALSE, 'Needs Attention panel on the coach dashboard (2.0)') ON CONFLICT (key) DO NOTHING;
