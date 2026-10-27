-- Weekly review access test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-00000000000a','client@t'),('00000000-0000-0000-0000-00000000000b','coach@t'),
 ('00000000-0000-0000-0000-00000000000c','coach2@t'),('00000000-0000-0000-0000-00000000000d','solo@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES
 ('00000000-0000-0000-0000-00000000000b','Coach B','active'),('00000000-0000-0000-0000-00000000000c','Coach C','active');
INSERT INTO public.coach_client_relationships(coach_id,client_id,status,share_scope) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{"food":true}');
-- client A is coached: draft is hidden from them. Solo user D: visible at once. One rejected review for D.
INSERT INTO public.ai_weekly_reviews(user_id,week_start,data_hash,source,status,visible_to_client,facts,sections) VALUES
 ('00000000-0000-0000-0000-00000000000a','2026-10-12','h','rules','draft',false,'[]','{}'),
 ('00000000-0000-0000-0000-00000000000d','2026-10-12','h','rules','draft',true,'[]','{}'),
 ('00000000-0000-0000-0000-00000000000d','2026-10-05','h','rules','rejected',false,'[]','{}');
INSERT INTO public.ai_insights(user_id,review_id,insight,evidence,source_metric)
 SELECT user_id,id,'x','[]','logging_adherence' FROM public.ai_weekly_reviews WHERE week_start='2026-10-12';

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('coached client cannot see unapproved review', (SELECT count(*) FROM public.ai_weekly_reviews), 0);
SELECT pg_temp.expect('coached client cannot see unapproved insight', (SELECT count(*) FROM public.ai_insights), 0);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach sees client draft review', (SELECT count(*) FROM public.ai_weekly_reviews), 1);
SELECT pg_temp.expect('coach sees client insight', (SELECT count(*) FROM public.ai_insights), 1);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('other coach sees nothing', (SELECT count(*) FROM public.ai_weekly_reviews), 0);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
SELECT pg_temp.expect('solo user sees visible review, not rejected', (SELECT count(*) FROM public.ai_weekly_reviews), 1);
SELECT pg_temp.expect('solo user sees own insight', (SELECT count(*) FROM public.ai_insights), 1);
DO $$ BEGIN
  BEGIN UPDATE public.ai_weekly_reviews SET status='approved'; RAISE NOTICE '% : client update changed no rows', CASE WHEN FOUND THEN 'FAIL' ELSE 'PASS' END;
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : client cannot update a review'; END;
END $$;
RESET ROLE;
-- the update above may be a silent no-op under RLS; confirm status is unchanged
SELECT pg_temp.expect('no review was approved by a client', (SELECT count(*) FROM public.ai_weekly_reviews WHERE status='approved'), 0);
