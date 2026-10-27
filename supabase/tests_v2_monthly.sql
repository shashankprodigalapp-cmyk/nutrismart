-- Monthly review test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got numeric, want numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000a1','u@t'),('00000000-0000-0000-0000-0000000000b1','c@t'),('00000000-0000-0000-0000-0000000000d1','s@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
UPDATE public.users SET target_cal=2000, target_protein=100 WHERE id='00000000-0000-0000-0000-0000000000a1';
INSERT INTO public.daily_logs(user_id,log_date,meal,food_name,portion,cal,protein,fat) VALUES
 ('00000000-0000-0000-0000-0000000000a1','2026-09-03','lunch','A','1',1800,80,40),
 ('00000000-0000-0000-0000-0000000000a1','2026-09-10','lunch','A','1',2000,100,40),
 ('00000000-0000-0000-0000-0000000000a1','2026-09-30','lunch','A','1',2200,60,40),
 ('00000000-0000-0000-0000-0000000000a1','2026-10-01','lunch','A','1',900,60,40);
SELECT pg_temp.expect('September has 30 days', (SELECT days_elapsed FROM public.compute_monthly_metrics('00000000-0000-0000-0000-0000000000a1','2026-09-01')), 30);
SELECT pg_temp.expect('3 logged days (Oct 1 excluded)', (SELECT days_logged FROM public.monthly_metrics WHERE month_start='2026-09-01'), 3);
SELECT pg_temp.expect('avg calories', (SELECT avg_calories FROM public.monthly_metrics WHERE month_start='2026-09-01'), 2000);
SELECT pg_temp.expect('avg protein', (SELECT avg_protein FROM public.monthly_metrics WHERE month_start='2026-09-01'), 80);
SELECT pg_temp.expect('logging 3 of 30 = 10', (SELECT logging_adherence FROM public.monthly_metrics WHERE month_start='2026-09-01'), 10);
SELECT pg_temp.expect('February has 28 days', (SELECT days_elapsed FROM public.compute_monthly_metrics('00000000-0000-0000-0000-0000000000a1','2026-02-01')), 28);

INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-0000000000b1','Coach','active');
INSERT INTO public.coach_client_relationships(coach_id,client_id,status,share_scope) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','active','{"food":true}');
INSERT INTO public.ai_monthly_reviews(user_id,month_start,data_hash,source,status,visible_to_client,facts,sections) VALUES
 ('00000000-0000-0000-0000-0000000000a1','2026-09-01','h','rules','draft',false,'[]','{}'),
 ('00000000-0000-0000-0000-0000000000d1','2026-09-01','h','rules','draft',true,'[]','{}');
INSERT INTO public.ai_insights(user_id,monthly_review_id,insight,evidence,source_metric) SELECT user_id,id,'x','[]','logging_adherence' FROM public.ai_monthly_reviews;
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('coached client: draft month hidden', (SELECT count(*) FROM public.ai_monthly_reviews), 0);
SELECT pg_temp.expect('coached client: draft insight hidden', (SELECT count(*) FROM public.ai_insights), 0);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('coach sees client month review', (SELECT count(*) FROM public.ai_monthly_reviews), 1);
SELECT pg_temp.expect('coach sees client month insight', (SELECT count(*) FROM public.ai_insights), 1);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
SELECT pg_temp.expect('solo user sees own month review', (SELECT count(*) FROM public.ai_monthly_reviews), 1);
SELECT pg_temp.expect('solo user sees own month insight', (SELECT count(*) FROM public.ai_insights), 1);
RESET ROLE;
