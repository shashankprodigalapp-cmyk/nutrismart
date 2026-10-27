-- NutriSmart 2.0 / Phase 10: nudges. Additive.
-- Opt-in reminders and short coach messages, with quiet hours and daily limits. Every nudge is recorded, including
-- the ones that were NOT sent and why, so behaviour can be audited.

CREATE TABLE IF NOT EXISTS public.nudge_preferences (
  user_id        UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  log_reminders  BOOLEAN NOT NULL DEFAULT FALSE,   -- opt-in: reminder in the evening if nothing is logged
  coach_nudges   BOOLEAN NOT NULL DEFAULT TRUE,    -- short messages from a linked coach
  quiet_start    SMALLINT NOT NULL DEFAULT 1290 CHECK (quiet_start BETWEEN 0 AND 1439),  -- minutes after midnight IST (21:30)
  quiet_end      SMALLINT NOT NULL DEFAULT 450  CHECK (quiet_end BETWEEN 0 AND 1439),    -- 07:30
  max_per_day    SMALLINT NOT NULL DEFAULT 2 CHECK (max_per_day BETWEEN 0 AND 5),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.nudges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,   -- recipient
  kind        TEXT NOT NULL CHECK (kind IN ('log_reminder','coach_message')),
  sent_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,           -- coach, for coach_message
  title       TEXT NOT NULL,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','skipped','failed')),
  skip_reason TEXT,
  dedupe_key  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nudges_user ON public.nudges (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nudges_queue ON public.nudges (status, created_at) WHERE status = 'queued';

ALTER TABLE public.nudge_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nudges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS np_own ON public.nudge_preferences;
CREATE POLICY np_own ON public.nudge_preferences FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
-- recipient sees their nudges; a coach sees the ones they sent. Nobody writes from the browser.
DROP POLICY IF EXISTS nudges_read ON public.nudges;
CREATE POLICY nudges_read ON public.nudges FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR sent_by = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.nudges FROM authenticated, anon;

INSERT INTO public.feature_flags (key, enabled, description) VALUES ('v2_nudges', FALSE, 'Nudges: coach messages and opt-in reminders (2.0). Off = nothing is sent.') ON CONFLICT (key) DO NOTHING;
