-- meal_outcomes test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','c@t'),('00000000-0000-0000-0000-00000000000b','k@t'),('00000000-0000-0000-0000-00000000000c','k2@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000b','Coach Bee','active'),('00000000-0000-0000-0000-00000000000c','Coach Cee','active');
INSERT INTO public.coach_client_relationships(coach_id,client_id,status,share_scope) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{"food":true,"energy":true,"mood":true}'),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','active','{"food":true,"energy":false,"mood":false}');
INSERT INTO public.daily_logs(user_id,log_date,meal,food_name,portion,cal,protein,carbs,fat,gl) VALUES
 ('00000000-0000-0000-0000-00000000000a',current_date,'lunch','Dal','1',200,12,30,5,8),
 ('00000000-0000-0000-0000-00000000000a',current_date,'lunch','Rice','1',300,6,65,1,15),
 ('00000000-0000-0000-0000-00000000000a',current_date,'dinner','Roti','1',120,4,22,2,9);
INSERT INTO public.energy_logs(user_id,log_date,level,meal_before) VALUES ('00000000-0000-0000-0000-00000000000a',current_date,'low','lunch');
INSERT INTO public.meal_feelings(user_id,log_date,meal,energy_change,fullness) VALUES ('00000000-0000-0000-0000-00000000000a',current_date,'lunch','lower','full');
SELECT pg_temp.expect('one row per meal', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30)), 2);
SELECT pg_temp.expect('lunch calories summed', (SELECT cal FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30) WHERE meal='lunch')::bigint, 500);
SELECT pg_temp.expect('lunch protein summed', (SELECT protein FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30) WHERE meal='lunch')::bigint, 18);
SELECT pg_temp.expect('feelings joined', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30) WHERE meal='lunch' AND energy_change='lower' AND fullness='full' AND energy_level='low'), 1);
SELECT pg_temp.expect('dinner has no notes', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30) WHERE meal='dinner' AND energy_level IS NULL AND energy_change IS NULL), 1);
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('person sees own meals', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30)), 2);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach with sharing sees meals', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30)), 2);
SELECT pg_temp.expect('coach with sharing sees notes', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30) WHERE energy_change IS NOT NULL), 1);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('coach with energy and mood off sees no notes', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30) WHERE energy_change IS NOT NULL OR energy_level IS NOT NULL), 0);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
SELECT pg_temp.expect('stranger sees nothing', (SELECT count(*) FROM public.meal_outcomes('00000000-0000-0000-0000-00000000000a', 30)), 0);
RESET ROLE;
