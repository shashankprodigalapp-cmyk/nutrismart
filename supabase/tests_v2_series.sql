-- Chart series test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','a@t'),('00000000-0000-0000-0000-00000000000b','coach@t'),('00000000-0000-0000-0000-00000000000c','c@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
UPDATE public.users SET target_cal = 2000, target_protein = 100, target_fat = 60;
INSERT INTO daily_logs(user_id,log_date,meal,food_name,portion,qty,is_home,multiplier,cal,protein,carbs,fat,gl,anomaly) VALUES
 ('00000000-0000-0000-0000-00000000000a',(now() AT TIME ZONE 'Asia/Kolkata')::date,'lunch','x','1',1,true,1,1000,50,100,30,1,false),
 ('00000000-0000-0000-0000-00000000000a',(now() AT TIME ZONE 'Asia/Kolkata')::date,'dinner','y','1',1,true,1,500,20,60,10,1,false),
 ('00000000-0000-0000-0000-00000000000c',(now() AT TIME ZONE 'Asia/Kolkata')::date-1,'lunch','z','1',1,true,1,800,30,80,20,1,false);
SELECT pg_temp.expect('30 days returned', jsonb_array_length(public.admin_daily_series(30)->'series')::text, '30');
SELECT pg_temp.expect('days limited to 120', public.admin_daily_series(9999)->>'days', '120');
SELECT pg_temp.expect('food logs today', (public.admin_daily_series(30)->'series'->29->>'food_logs'), '2');
SELECT pg_temp.expect('active people yesterday', (public.admin_daily_series(30)->'series'->28->>'active_people'), '1');
SELECT pg_temp.expect('depth has 8 buckets', jsonb_array_length(public.admin_daily_series(30)->'depth_7d')::text, '8');
SELECT pg_temp.expect('people who logged 0 days = 1 (the coach)', (SELECT (e->>'people') FROM jsonb_array_elements(public.admin_daily_series(30)->'depth_7d') e WHERE e->>'days_logged'='0'), '1');
SELECT pg_temp.expect('people who logged 1 day = 2', (SELECT (e->>'people') FROM jsonb_array_elements(public.admin_daily_series(30)->'depth_7d') e WHERE e->>'days_logged'='1'), '2');
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.admin_daily_series(30); RAISE NOTICE 'FAIL : signed-in user read admin series';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : signed-in user cannot read admin series'; END;
END $$;
RESET ROLE;
-- coach series
INSERT INTO coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000b','Coach','active');
INSERT INTO coach_client_relationships(coach_id,client_id,status,share_scope,accepted_at) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{"food":true,"energy":false}',now()),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c','active','{"food":false}',now());
SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach sees 14 days for the sharing client only', (SELECT count(*)::text FROM public.coach_client_series(14)), '14');
SELECT pg_temp.expect('client not sharing food is hidden', (SELECT count(*)::text FROM public.coach_client_series(14, '00000000-0000-0000-0000-00000000000c')), '0');
SELECT pg_temp.expect('today calories', (SELECT calories::text FROM public.coach_client_series(14) WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), '1500.0');
SELECT pg_temp.expect('today protein', (SELECT protein_g::text FROM public.coach_client_series(14) WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), '70.0');
SELECT pg_temp.expect('target comes through', (SELECT target_cal::text FROM public.coach_client_series(14) WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), '2000');
SELECT pg_temp.expect('empty days are zero not missing', (SELECT items::text FROM public.coach_client_series(14) WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date - 3), '0');
SELECT pg_temp.expect('energy hidden when not shared', (SELECT count(energy)::text FROM public.coach_client_series(14)), '0');
SELECT pg_temp.expect('days limited to 31', (SELECT count(*)::text FROM public.coach_client_series(9999)), '31');
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('a non-coach sees nothing', (SELECT count(*)::text FROM public.coach_client_series(14)), '0');
RESET ROLE;
