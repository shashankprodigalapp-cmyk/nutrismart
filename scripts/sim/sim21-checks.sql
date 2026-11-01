-- Run after sim21-load.sql on the scratch database. Every line must say PASS. Uses the same "act as this person" trick the app uses.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;

SELECT pg_temp.expect('100 people and 3 coaches loaded', (SELECT count(*) FROM public.users), 103);
SELECT pg_temp.expect('feature rows loaded (windows 1/7/14/30/90 per person)', (SELECT count(DISTINCT user_id) FROM public.personal_features), 100);
SELECT pg_temp.expect('every feature row has a legal window and confidence', (SELECT count(*) FROM public.personal_features WHERE window_days NOT IN (1,7,14,30,90)), 0);
SELECT pg_temp.expect('no feature row has a value but no sample', (SELECT count(*) FROM public.personal_features WHERE value IS NOT NULL AND sample_size = 0), 0);
SELECT pg_temp.expect('every recommendation is complete', (SELECT count(*) FROM public.recommendations WHERE reason = '' OR action = '' OR expected_outcome = '' OR follow_up_at IS NULL OR jsonb_array_length(evidence) = 0), 0);
SELECT pg_temp.expect('no unsent draft is marked sent', (SELECT count(*) FROM public.intel_messages WHERE status <> 'draft'), 0);
SELECT pg_temp.expect('no message longer than 140 characters', (SELECT count(*) FROM public.intel_messages WHERE length(body) > 140), 0);

-- Isolation: each person, acting as themselves, sees exactly their own rows and nothing of anyone else's.
DO $$
DECLARE u record; own_f bigint; all_f bigint; bad_f int := 0; bad_r int := 0; bad_m int := 0; bad_w int := 0; n int := 0; seen bigint;
BEGIN
  FOR u IN SELECT id FROM public.users WHERE email LIKE 'sim21-0%' OR email LIKE 'sim21-1%' LOOP
    n := n + 1;
    PERFORM set_config('request.jwt.claim.sub', u.id::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO seen FROM public.personal_features WHERE user_id <> u.id; IF seen > 0 THEN bad_f := bad_f + 1; END IF;
    SELECT count(*) INTO seen FROM public.recommendations WHERE user_id <> u.id; IF seen > 0 THEN bad_r := bad_r + 1; END IF;
    SELECT count(*) INTO seen FROM public.intel_messages WHERE status = 'draft'; IF seen > 0 THEN bad_m := bad_m + 1; END IF;
    BEGIN INSERT INTO public.personal_features(user_id,feature_key,window_days) VALUES (u.id,'hack',7); bad_w := bad_w + 1; EXCEPTION WHEN insufficient_privilege OR OTHERS THEN NULL; END;
    RESET ROLE;
  END LOOP;
  RAISE NOTICE '% : % people checked, % leaks of features', CASE WHEN bad_f = 0 THEN 'PASS' ELSE 'FAIL' END, n, bad_f;
  RAISE NOTICE '% : no one saw another person''s recommendations (% leaks)', CASE WHEN bad_r = 0 THEN 'PASS' ELSE 'FAIL' END, bad_r;
  RAISE NOTICE '% : no one saw an unsent coach draft (% leaks)', CASE WHEN bad_m = 0 THEN 'PASS' ELSE 'FAIL' END, bad_m;
  RAISE NOTICE '% : no one could write their own features from the browser (% writes got through)', CASE WHEN bad_w = 0 THEN 'PASS' ELSE 'FAIL' END, bad_w;
END $$;
