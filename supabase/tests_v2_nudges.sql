-- Nudge access test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','client@t'),('00000000-0000-0000-0000-00000000000b','coach@t'),('00000000-0000-0000-0000-00000000000c','other@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.nudges(user_id,kind,sent_by,title,body,dedupe_key,status) VALUES
 ('00000000-0000-0000-0000-00000000000a','coach_message','00000000-0000-0000-0000-00000000000b','t','hello','k1','sent');
-- one coach nudge per coach, client, day: same key is refused
DO $$ BEGIN
  BEGIN INSERT INTO public.nudges(user_id,kind,title,body,dedupe_key) VALUES ('00000000-0000-0000-0000-00000000000a','coach_message','t','again','k1'); RAISE NOTICE 'FAIL : duplicate key accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS : second nudge same day refused'; END;
END $$;
DO $$ BEGIN
  BEGIN INSERT INTO public.nudges(user_id,kind,title,body,dedupe_key) VALUES ('00000000-0000-0000-0000-00000000000a','coach_message','t',repeat('x',201),'k2'); RAISE NOTICE 'FAIL : long body accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : body over 200 chars refused'; END;
END $$;
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('recipient sees nudge', (SELECT count(*) FROM public.nudges), 1);
INSERT INTO public.nudge_preferences(user_id,log_reminders) VALUES ('00000000-0000-0000-0000-00000000000a', true);
SELECT pg_temp.expect('own preferences saved', (SELECT count(*) FROM public.nudge_preferences), 1);
DO $$ BEGIN
  BEGIN INSERT INTO public.nudges(user_id,kind,title,body,dedupe_key) VALUES ('00000000-0000-0000-0000-00000000000a','log_reminder','t','x','k3'); RAISE NOTICE 'FAIL : browser inserted nudge';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : browser cannot create nudges'; END;
END $$;
DO $$ BEGIN
  BEGIN INSERT INTO public.nudge_preferences(user_id) VALUES ('00000000-0000-0000-0000-00000000000b'); RAISE NOTICE 'FAIL : wrote another person''s preferences';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'PASS : cannot write another person''s preferences'; END;
END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach sees nudges they sent', (SELECT count(*) FROM public.nudges), 1);
SELECT pg_temp.expect('coach cannot read client preferences', (SELECT count(*) FROM public.nudge_preferences), 0);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('stranger sees nothing', (SELECT count(*) FROM public.nudges), 0);
RESET ROLE;
