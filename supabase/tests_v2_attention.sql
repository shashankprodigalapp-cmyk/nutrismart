-- Needs Attention access test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','c@t'),('00000000-0000-0000-0000-00000000000b','k1@t'),('00000000-0000-0000-0000-00000000000c','k2@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.attention_actions(coach_id,client_id,signal,action,severity,until_at) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','logging_decline','snoozed','attention',now()+interval '3 days'),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','logging_decline','dismissed','drifting',NULL);
SELECT pg_temp.expect('rows stored', (SELECT count(*) FROM public.attention_actions), 2);
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach sees only own actions', (SELECT count(*) FROM public.attention_actions), 1);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('client sees none', (SELECT count(*) FROM public.attention_actions), 0);
DO $$ BEGIN
  BEGIN INSERT INTO public.attention_actions(coach_id,client_id,signal,action,severity,until_at) VALUES ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','energy_decline','dismissed','drifting',NULL);
    RAISE NOTICE 'FAIL : browser could insert';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : browser cannot insert'; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN INSERT INTO public.attention_actions(coach_id,client_id,signal,action,severity,until_at) VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c','energy_decline','snoozed','drifting',NULL);
    RAISE NOTICE 'FAIL : snooze without end accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : snooze needs an end date'; END;
END $$;
