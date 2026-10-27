-- NutriSmart 2.0 / Phase 11: switch for voice logging. Additive. Off by default.
INSERT INTO public.feature_flags (key, enabled, description) VALUES ('v2_voice', FALSE, 'Voice logging: mic button on the log screen (2.0)') ON CONFLICT (key) DO NOTHING;
