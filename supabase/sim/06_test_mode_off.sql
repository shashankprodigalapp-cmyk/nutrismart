-- TEST MODE OFF: puts every feature switch back exactly as it was before 05_test_mode_on.sql.
UPDATE public.feature_flags f SET enabled = s.was_enabled FROM public.test_mode_snapshot s WHERE s.key = f.key;
DELETE FROM public.test_mode_snapshot;
SELECT 'Test mode OFF: ' || count(*) || ' switches are on now' AS result FROM public.feature_flags WHERE enabled;
