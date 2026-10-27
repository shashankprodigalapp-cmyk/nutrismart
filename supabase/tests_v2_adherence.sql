-- Adherence maths test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.eq(label text, got numeric, want numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000a1','u@t');
INSERT INTO public.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000a1','u@t') ON CONFLICT DO NOTHING;
UPDATE public.users SET target_cal=2000, target_protein=100, target_fat=60 WHERE id='00000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.eq('band 1.0', public.band_score(1.0), 100);
SELECT pg_temp.eq('band 0.9 edge', public.band_score(0.9), 100);
SELECT pg_temp.eq('band 0.7', public.band_score(0.7), 50);
SELECT pg_temp.eq('band 1.3', public.band_score(1.3), 50);
SELECT pg_temp.eq('band 0.5', public.band_score(0.5), 0);
SELECT pg_temp.eq('band 1.6', public.band_score(1.6), 0);
SELECT pg_temp.eq('band null', public.band_score(NULL), NULL);

INSERT INTO public.daily_logs(user_id,log_date,meal,food_name,portion,cal,protein,fat) VALUES
 ('00000000-0000-0000-0000-0000000000a1','2026-10-20','lunch','A','1',1400,50,30),
 ('00000000-0000-0000-0000-0000000000a1','2026-10-20','dinner','B','1',400,10,12);
-- 1800 kcal of 2000 = 0.9 -> 100 ; protein 60/100 -> 60 ; fat 42/60 = 0.7 -> 50 ; macro avg(60,50)=55
SELECT pg_temp.eq('calorie_adherence', (SELECT calorie_adherence FROM public.daily_adherence WHERE day='2026-10-20'), 100);
SELECT pg_temp.eq('protein_adherence', (SELECT protein_adherence FROM public.daily_adherence WHERE day='2026-10-20'), 60);
SELECT pg_temp.eq('fat_adherence', (SELECT fat_adherence FROM public.daily_adherence WHERE day='2026-10-20'), 50);
SELECT pg_temp.eq('macro_adherence', (SELECT macro_adherence FROM public.daily_adherence WHERE day='2026-10-20'), 55);
SELECT pg_temp.eq('logging 100', (SELECT logging_adherence FROM public.daily_adherence WHERE day='2026-10-20'), 100);
SELECT pg_temp.eq('checkin 0 without energy', (SELECT checkin_adherence FROM public.daily_adherence WHERE day='2026-10-20'), 0);
SELECT pg_temp.eq('metrics meals', (SELECT meals FROM public.daily_nutrition_metrics WHERE day='2026-10-20'), 2);

INSERT INTO public.energy_logs(user_id,log_date,level) VALUES ('00000000-0000-0000-0000-0000000000a1','2026-10-20','steady');
SELECT pg_temp.eq('checkin 100 after energy', (SELECT checkin_adherence FROM public.daily_adherence WHERE day='2026-10-20'), 100);

-- protein above target is capped at 100
INSERT INTO public.daily_logs(user_id,log_date,meal,food_name,portion,cal,protein,fat) VALUES ('00000000-0000-0000-0000-0000000000a1','2026-10-21','lunch','C','1',2000,150,60);
SELECT pg_temp.eq('protein capped', (SELECT protein_adherence FROM public.daily_adherence WHERE day='2026-10-21'), 100);

-- deleting everything for a day: logging 0 and scores NULL (missing, not failure)
DELETE FROM public.daily_logs WHERE log_date='2026-10-21';
SELECT pg_temp.eq('logging 0 when empty', (SELECT logging_adherence FROM public.daily_adherence WHERE day='2026-10-21'), 0);
SELECT pg_temp.eq('calorie NULL when empty', (SELECT calorie_adherence FROM public.daily_adherence WHERE day='2026-10-21'), NULL);

-- a coach target in force replaces the personal one
INSERT INTO public.nutrition_targets(client_id,source,calories,protein_g,effective_from) VALUES ('00000000-0000-0000-0000-0000000000a1','coach',1800,90,'2026-10-01');
SELECT public.compute_adherence_day('00000000-0000-0000-0000-0000000000a1','2026-10-20');
SELECT pg_temp.eq('coach target used', (SELECT target_cal FROM public.daily_adherence WHERE day='2026-10-20'), 1800);
-- a target set later does not rewrite earlier days
INSERT INTO public.nutrition_targets(client_id,source,calories,protein_g,effective_from) VALUES ('00000000-0000-0000-0000-0000000000a1','coach',1500,90,'2026-10-25');
SELECT public.compute_adherence_day('00000000-0000-0000-0000-0000000000a1','2026-10-20');
SELECT pg_temp.eq('old day keeps old target', (SELECT target_cal FROM public.daily_adherence WHERE day='2026-10-20'), 1800);
-- logging is never blocked if adherence breaks
ALTER TABLE public.daily_adherence RENAME TO daily_adherence_x;
INSERT INTO public.daily_logs(user_id,log_date,meal,food_name,portion,cal) VALUES ('00000000-0000-0000-0000-0000000000a1','2026-10-22','lunch','D','1',100);
SELECT pg_temp.eq('log still saved if adherence broken', (SELECT count(*) FROM public.daily_logs WHERE food_name='D'), 1);
ALTER TABLE public.daily_adherence_x RENAME TO daily_adherence;
