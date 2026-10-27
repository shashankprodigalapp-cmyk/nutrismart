-- RLS test for 2.0 foundation. Run on a scratch database (never production). Prints PASS/FAIL lines.
\set ON_ERROR_STOP 0
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;

TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-00000000000a','client@t'),('00000000-0000-0000-0000-00000000000b','coach@t'),
 ('00000000-0000-0000-0000-00000000000c','coach2@t'),('00000000-0000-0000-0000-00000000000d','other@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES
 ('00000000-0000-0000-0000-00000000000b','Coach B','active'),('00000000-0000-0000-0000-00000000000c','Coach C','active');
INSERT INTO public.coach_client_relationships(coach_id,client_id,status,share_scope) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{"food":true,"energy":false,"water":true}');
INSERT INTO public.daily_logs(user_id,log_date,meal,food_name,portion,cal) VALUES
 ('00000000-0000-0000-0000-00000000000a',current_date,'lunch','Dal','1 katori',150),
 ('00000000-0000-0000-0000-00000000000d',current_date,'lunch','Rice','1 bowl',200);
INSERT INTO public.energy_logs(user_id,log_date,level) VALUES ('00000000-0000-0000-0000-00000000000a',current_date,'low');
SELECT pg_temp.expect('timeline trigger wrote 2 events for client', (SELECT count(*) FROM public.timeline_events WHERE user_id='00000000-0000-0000-0000-00000000000a'), 2);

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('client sees own food', (SELECT count(*) FROM public.daily_logs), 1);
SELECT pg_temp.expect('client sees own timeline', (SELECT count(*) FROM public.timeline_events), 2);
SELECT pg_temp.expect('client sees their relationship', (SELECT count(*) FROM public.coach_client_relationships), 1);
SELECT pg_temp.expect('client sees coach profile', (SELECT count(*) FROM public.coach_profiles), 1);

SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach sees assigned client food only', (SELECT count(*) FROM public.daily_logs), 1);
SELECT pg_temp.expect('coach blocked from energy (scope off)', (SELECT count(*) FROM public.energy_logs), 0);
SELECT pg_temp.expect('coach timeline limited to allowed scopes', (SELECT count(*) FROM public.timeline_events), 1);
SELECT pg_temp.expect('coach cannot read audit logs', (SELECT count(*) FROM (SELECT 1 FROM public.audit_logs) x), 0);

SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('other coach sees nothing', (SELECT count(*) FROM public.daily_logs), 0);
SELECT pg_temp.expect('other coach sees no timeline', (SELECT count(*) FROM public.timeline_events), 0);

SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
SELECT pg_temp.expect('unrelated user sees own only', (SELECT count(*) FROM public.daily_logs), 1);

-- coach can set targets for own client only
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
DO $$ BEGIN
  INSERT INTO public.nutrition_targets(client_id,set_by,source,calories,protein_g) VALUES ('00000000-0000-0000-0000-00000000000a',auth.uid(),'coach',1800,110);
  RAISE NOTICE 'PASS : coach set target for own client';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL : coach set target for own client (%)', SQLERRM; END $$;
DO $$ BEGIN
  INSERT INTO public.nutrition_targets(client_id,set_by,source,calories,protein_g) VALUES ('00000000-0000-0000-0000-00000000000d',auth.uid(),'coach',1800,110);
  RAISE NOTICE 'FAIL : coach set target for stranger (allowed!)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS : coach blocked from stranger (%)', SQLERRM; END $$;
-- nobody can self-promote to coach / approve
DO $$ BEGIN
  INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES (auth.uid(),'X','active');
  RAISE NOTICE 'FAIL : client wrote coach_profiles directly';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS : coach_profiles write blocked for clients'; END $$;
DO $$ BEGIN
  INSERT INTO public.coach_client_relationships(coach_id,client_id,status) VALUES (auth.uid(),'00000000-0000-0000-0000-00000000000d','active');
  RAISE NOTICE 'FAIL : relationship created from browser role';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS : relationship writes blocked from browser role'; END $$;
SELECT pg_temp.expect('app roles for coach', (SELECT (public.my_roles()->>'coach')::boolean::int), 1);
SELECT pg_temp.expect('flags readable', (SELECT count(*) FROM public.feature_flags), 5);
RESET ROLE;
-- timeline must never block logging: break the timeline table and log anyway
ALTER TABLE public.timeline_events RENAME TO timeline_events_x;
INSERT INTO public.daily_logs(user_id,log_date,meal,food_name,portion,cal) VALUES ('00000000-0000-0000-0000-00000000000a',current_date,'dinner','Roti','1',100);
SELECT pg_temp.expect('logging still works with broken timeline', (SELECT count(*) FROM public.daily_logs WHERE food_name='Roti'), 1);
ALTER TABLE public.timeline_events_x RENAME TO timeline_events;
