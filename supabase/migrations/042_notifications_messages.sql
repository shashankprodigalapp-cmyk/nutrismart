-- NutriSmart 2.1 / P4: smart notification decisions, messages (automatic, coach, AI-drafted), fatigue controls.
-- ADDITIVE ONLY.

-- A new nudge kind for decisions made by the notification engine.
ALTER TABLE public.nudges DROP CONSTRAINT IF EXISTS nudges_kind_check;
ALTER TABLE public.nudges ADD CONSTRAINT nudges_kind_check CHECK (kind IN ('log_reminder','coach_message','smart'));

-- Per-person controls. Smart notifications are opt-in. Kinds the person turned off are listed in smart_kinds_off.
ALTER TABLE public.nudge_preferences ADD COLUMN IF NOT EXISTS smart_nudges BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.nudge_preferences ADD COLUMN IF NOT EXISTS smart_kinds_off TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.nudge_preferences ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'push' CHECK (channel IN ('push','in_app'));

-- Why each notification was (or was not) selected, and what happened next.
CREATE TABLE IF NOT EXISTS public.notification_decisions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('morning_verdict','meal_suggestion','protein_reminder','flexible_prep','check_in','positive','missed_logging','weekly_review','coach_nudge')),
  decision     TEXT NOT NULL CHECK (decision IN ('send','defer','skip')),
  reason_code  TEXT NOT NULL,
  why          JSONB NOT NULL DEFAULT '{}'::jsonb,
  fatigue      NUMERIC(4,2) NOT NULL DEFAULT 0,
  dedupe_key   TEXT NOT NULL,
  rec_id       UUID REFERENCES public.recommendations(id) ON DELETE SET NULL,
  nudge_id     UUID REFERENCES public.nudges(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  opened_at    TIMESTAMPTZ,
  acted_at     TIMESTAMPTZ,
  outcome      TEXT CHECK (outcome IN ('helped','no_change','ignored')),
  UNIQUE (user_id, dedupe_key, decision)
);
CREATE INDEX IF NOT EXISTS notification_decisions_user_idx ON public.notification_decisions (user_id, decided_at DESC);

-- Messages: automatic, from a coach, or drafted by the AI for a coach to review before it is sent.
CREATE TABLE IF NOT EXISTS public.intel_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,     -- recipient
  sender_type   TEXT NOT NULL CHECK (sender_type IN ('auto','coach','ai_draft')),
  sender_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL,
  rec_id        UUID REFERENCES public.recommendations(id) ON DELETE SET NULL,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','rejected')),
  delivery      TEXT CHECK (delivery IN ('sent','queued','skipped','failed')),
  response      TEXT CHECK (response IN ('read','done','not_now')),
  outcome       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  responded_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS intel_messages_user_idx ON public.intel_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS intel_messages_sender_idx ON public.intel_messages (sender_id, created_at DESC);

ALTER TABLE public.notification_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intel_messages         ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nd_own_read ON public.notification_decisions;
DROP POLICY IF EXISTS im_read     ON public.intel_messages;
CREATE POLICY nd_own_read ON public.notification_decisions FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
-- Recipient sees only messages that were really sent to them (never a draft). The sender sees their own drafts and sent messages.
CREATE POLICY im_read ON public.intel_messages FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid()) AND status = 'sent') OR sender_id = (SELECT auth.uid()));

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('smart_notifications', FALSE, '2.1 Notification decision engine with fatigue control'),
  ('messaging',           FALSE, '2.1 Messages with AI-drafted coach messages reviewed before sending')
ON CONFLICT (key) DO NOTHING;
