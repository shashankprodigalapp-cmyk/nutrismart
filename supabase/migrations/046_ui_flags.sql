-- 046: three switches for the Stage 1 delight layer. Additive only; all OFF by default.
-- Safe to run twice. Does not touch any existing table or switch.
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('ui_celebrations', FALSE, 'Stage 1: short celebration pop after a meal is logged (user can turn it off)'),
  ('ui_plate',        FALSE, 'Stage 1: Today''s plate card (protein first) and a hide-calories option'),
  ('ui_welcome_back', FALSE, 'Stage 1: gentle welcome-back card after a few days away')
ON CONFLICT (key) DO NOTHING;
