-- 049: Sparks ledger (points) + one switch. Additive only; the switch is OFF by default.
-- Safe to run twice. Does not touch any existing table or switch.
-- People can READ their own rows. Nobody can write from the browser: only the server (service role) awards Sparks,
-- from the person's real logs, one award per day/kind/ref, never above the daily cap.
CREATE TABLE IF NOT EXISTS public.sparks_ledger (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('meal', 'water', 'quest_all')),
  ref        TEXT NOT NULL DEFAULT '',
  points     INTEGER NOT NULL CHECK (points BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, day, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_sparks_user_day ON public.sparks_ledger (user_id, day DESC);
ALTER TABLE public.sparks_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sparks_own_read ON public.sparks_ledger;
CREATE POLICY sparks_own_read ON public.sparks_ledger FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('ui_sparks', FALSE, 'Stage B: Sparks (points from logging and water), levels and daily quests on Today')
ON CONFLICT (key) DO NOTHING;
