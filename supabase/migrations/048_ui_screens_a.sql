-- 048: switch for the new Today hero and line icons (Stage A screens). Additive; OFF by default.
-- Safe to run twice. Does not touch any existing table or switch.
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('ui_screens_a', FALSE, 'New Today hero (thali + one next step) and line icons in the navigation')
ON CONFLICT (key) DO NOTHING;
