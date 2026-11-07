-- 047: one switch for the new look (Evergreen / Ivory theme + Light/Dark/System). Additive; OFF by default.
-- Safe to run twice. Does not touch any existing table or switch.
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('ui_new_design', FALSE, 'New look: Evergreen/Ivory palette, light + dark + system appearance setting')
ON CONFLICT (key) DO NOTHING;
