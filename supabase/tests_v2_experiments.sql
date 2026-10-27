-- Experiments test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','c@t'),('00000000-0000-0000-0000-00000000000b','k@t'),('00000000-0000-0000-0000-00000000000c','k2@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000b','Coach Bee','active'),('00000000-0000-0000-0000-00000000000c','Coach Cee','active');
INSERT INTO public.coach_client_relationships(coach_id,client_id,status,share_scope) VALUES
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{"mood":true}'),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a','active','{"mood":false}');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
INSERT INTO public.experiments(user_id,template,title,actions,metrics,start_date,duration_days) VALUES ('00000000-0000-0000-0000-00000000000a','afternoon_energy','Improve afternoon energy','["a","b"]','["energy"]',current_date,7);
SELECT pg_temp.expect('person starts an experiment', (SELECT count(*) FROM public.experiments), 1);
DO $$ DECLARE eid uuid; BEGIN
  BEGIN INSERT INTO public.experiments(user_id,template,title,actions,metrics,start_date,duration_days) VALUES ('00000000-0000-0000-0000-00000000000a','x','Second one','["a"]','["mood"]',current_date,7); RAISE NOTICE 'FAIL : two active experiments';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS : only one active experiment'; END;
  BEGIN INSERT INTO public.experiments(user_id,template,title,actions,metrics,start_date,duration_days,status) VALUES ('00000000-0000-0000-0000-00000000000a','x','Too long','["a"]','["mood"]',current_date,60,'completed'); RAISE NOTICE 'FAIL : 60 day experiment';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : duration limited to 28 days'; END;
  BEGIN INSERT INTO public.experiments(user_id,template,title,actions,metrics,start_date,duration_days,status) VALUES ('00000000-0000-0000-0000-00000000000a','x','No steps','[]','["mood"]',current_date,7,'completed'); RAISE NOTICE 'FAIL : no steps';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : needs at least one step'; END;
  BEGIN INSERT INTO public.experiments(user_id,template,title,actions,metrics,start_date,duration_days) VALUES ('00000000-0000-0000-0000-00000000000b','x','For someone else','["a"]','["mood"]',current_date,7); RAISE NOTICE 'FAIL : wrote for someone else';
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN RAISE NOTICE 'PASS : cannot create for someone else'; END;
  SELECT id INTO eid FROM public.experiments LIMIT 1;
  INSERT INTO public.experiment_days(experiment_id,user_id,day,done) VALUES (eid,'00000000-0000-0000-0000-00000000000a',current_date,'[0,1]');
  RAISE NOTICE 'PASS : person ticks steps';
END $$;
UPDATE public.experiments SET status = 'completed';
SELECT pg_temp.expect('person can finish', (SELECT count(*) FROM public.experiments WHERE status='completed'), 1);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('coach with mood sharing sees experiment', (SELECT count(*) FROM public.experiments), 1);
SELECT pg_temp.expect('coach sees ticks', (SELECT count(*) FROM public.experiment_days), 1);
DO $$ BEGIN
  UPDATE public.experiments SET title = 'Changed by coach';
  IF FOUND THEN RAISE NOTICE 'FAIL : coach edited an experiment'; ELSE RAISE NOTICE 'PASS : coach cannot edit an experiment'; END IF;
END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('coach with sharing off sees nothing', (SELECT count(*) FROM public.experiments) + (SELECT count(*) FROM public.experiment_days), 0);
RESET ROLE;
