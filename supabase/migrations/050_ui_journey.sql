-- 050: two switches for the Journey page. Additive only; both OFF by default.
-- ui_journey   : the Journey page (levels, Food Explorer) and the link to it from the Sparks card.
-- ui_detective : the Kitchen Detective lessons. Turn on ONLY after a qualified nutrition professional has reviewed src/content/lessons.ts.
-- Safe to run twice. Does not touch any existing table or switch.
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('ui_journey',   FALSE, 'Stage C: Journey page with levels and Food Explorer (regional kitchens tried)'),
  ('ui_detective', FALSE, 'Stage C: Kitchen Detective lessons. Turn on only after a nutrition professional has reviewed the lessons')
ON CONFLICT (key) DO NOTHING;
