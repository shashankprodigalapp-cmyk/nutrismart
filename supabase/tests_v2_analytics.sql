-- 2.0 analytics test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','a@t'),('00000000-0000-0000-0000-00000000000b','b@t'),('00000000-0000-0000-0000-00000000000c','c@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO daily_checkins(user_id,log_date,mood) VALUES ('00000000-0000-0000-0000-00000000000a',current_date,3),('00000000-0000-0000-0000-00000000000a',current_date-1,4),('00000000-0000-0000-0000-00000000000b',current_date,2);
SELECT pg_temp.expect('people using check-ins counted once each', public.admin_v2_analytics(30)->'adoption'->>'daily_checkins', '2');
INSERT INTO coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000b','Coach Bee','active'),('00000000-0000-0000-0000-00000000000c','Coach Cee','pending');
INSERT INTO coach_client_relationships(coach_id,client_id,status,share_scope,accepted_at) VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{}',now());
INSERT INTO coach_client_relationships(coach_id,status) VALUES ('00000000-0000-0000-0000-00000000000b','invited');
SELECT pg_temp.expect('coaches applied', public.admin_v2_analytics(30)->'coach'->>'applied', '2');
SELECT pg_temp.expect('coaches approved', public.admin_v2_analytics(30)->'coach'->>'approved', '1');
SELECT pg_temp.expect('coaches with an active client', public.admin_v2_analytics(30)->'coach'->>'has_active_client', '1');
SELECT pg_temp.expect('invites sent', public.admin_v2_analytics(30)->'coach'->>'invites_sent', '2');
SELECT pg_temp.expect('invites accepted', public.admin_v2_analytics(30)->'coach'->>'invites_accepted', '1');
SELECT pg_temp.expect('coach whose client logged this week: none yet', public.admin_v2_analytics(30)->'coach'->>'client_logged_7d', '0');
INSERT INTO nudge_preferences(user_id,log_reminders) VALUES ('00000000-0000-0000-0000-00000000000a',true),('00000000-0000-0000-0000-00000000000b',false);
SELECT pg_temp.expect('reminders on', public.admin_v2_analytics(30)->'adoption'->>'reminders_enabled', '1');
SELECT pg_temp.expect('cohort size this week', (SELECT sum((c->>'size')::int)::text FROM jsonb_array_elements(public.admin_v2_analytics(30)->'cohorts') c), '3');
SELECT pg_temp.expect('days limited to 180', public.admin_v2_analytics(9999)->>'days', '180');
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.admin_v2_analytics(30); RAISE NOTICE 'FAIL : signed-in user read analytics';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : signed-in user cannot read analytics'; END;
END $$;
RESET ROLE;
