-- TEST MODE ON: switches every 2.0 feature on so nothing needs manual switching. Remembers what was on before.
-- Reverse with 06_test_mode_off.sql. Safe to run twice (the first snapshot is kept).
CREATE TABLE IF NOT EXISTS public.test_mode_snapshot (key TEXT PRIMARY KEY, was_enabled BOOLEAN NOT NULL, saved_at TIMESTAMPTZ DEFAULT now());
INSERT INTO public.test_mode_snapshot (key, was_enabled) SELECT key, enabled FROM public.feature_flags ON CONFLICT (key) DO NOTHING;
UPDATE public.feature_flags SET enabled = TRUE;
SELECT 'Test mode ON: ' || count(*) || ' feature switches are now on' AS result FROM public.feature_flags WHERE enabled;
