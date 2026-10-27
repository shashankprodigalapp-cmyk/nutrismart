-- NutriSmart 2.0 / Phase 12: switch for the improved photo review card. Additive. Off by default.
INSERT INTO public.feature_flags (key, enabled, description) VALUES ('v2_photo', FALSE, 'Photo logging: ranges, food-list matching, uncertainty notes (2.0)') ON CONFLICT (key) DO NOTHING;
