-- Check-in access test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','client@t'),('00000000-0000-0000-0000-00000000000b','coach@t'),('00000000-0000-0000-0000-00000000000c','coach2@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000b','Coach Bee','active'),('00000000-0000-0000-0000-00000000000c','Coach Cee','active');
INSERT INTO public.coach_client_relationships(coach_id,client_id,status,share_scope) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{"food":true,"mood":true}'),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','active','{"food":true,"mood":false}');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
INSERT INTO public.daily_checkins(user_id,log_date,energy,mood,sleep,stress,hunger) VALUES ('00000000-0000-0000-0000-00000000000a','2026-10-20',4,3,'good','low',2);
INSERT INTO public.meal_feelings(user_id,log_date,meal,energy_change,fullness) VALUES ('00000000-0000-0000-0000-00000000000a','2026-10-20','lunch','lower','full');
SELECT pg_temp.expect('client saves check-in', (SELECT count(*) FROM public.daily_checkins), 1);
UPDATE public.daily_checkins SET mood = 5 WHERE log_date='2026-10-20';
SELECT pg_temp.expect('client edits own check-in', (SELECT mood FROM public.daily_checkins)::bigint, 5);
DO $$ BEGIN
  BEGIN INSERT INTO public.daily_checkins(user_id,log_date,mood) VALUES ('00000000-0000-0000-0000-00000000000a','2026-10-20',2); RAISE NOTICE 'FAIL : second check-in same day';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS : one check-in per day'; END;
  BEGIN INSERT INTO public.daily_checkins(user_id,log_date,mood) VALUES ('00000000-0000-0000-0000-00000000000a','2026-10-21',6); RAISE NOTICE 'FAIL : mood 6 accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : mood must be 1 to 5'; END;
  BEGIN INSERT INTO public.daily_checkins(user_id,log_date) VALUES ('00000000-0000-0000-0000-00000000000a','2026-10-22'); RAISE NOTICE 'FAIL : empty check-in accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : empty check-in refused'; END;
  BEGIN INSERT INTO public.daily_checkins(user_id,log_date,mood) VALUES ('00000000-0000-0000-0000-00000000000b','2026-10-23',3); RAISE NOTICE 'FAIL : wrote for someone else';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : cannot write for someone else'; END;
END $$;
SELECT pg_temp.expect('timeline got one line per check-in', (SELECT count(*) FROM public.timeline_events WHERE event_type='checkin_logged'), 1);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach with mood switch on sees check-in', (SELECT count(*) FROM public.daily_checkins), 1);
SELECT pg_temp.expect('coach sees meal feeling', (SELECT count(*) FROM public.meal_feelings), 1);
DO $$ BEGIN
  BEGIN UPDATE public.daily_checkins SET mood = 1; IF FOUND THEN RAISE NOTICE 'FAIL : coach edited a check-in'; ELSE RAISE NOTICE 'PASS : coach cannot edit a check-in'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : coach cannot edit a check-in'; END;
END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('coach with mood switch off sees nothing', (SELECT count(*) FROM public.daily_checkins), 0);
SELECT pg_temp.expect('coach with switch off sees no feelings', (SELECT count(*) FROM public.meal_feelings), 0);
RESET ROLE;
