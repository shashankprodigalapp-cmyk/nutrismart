-- Plans test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','a@t'),('00000000-0000-0000-0000-00000000000b','b@t'),('00000000-0000-0000-0000-00000000000c','c@t'),('00000000-0000-0000-0000-00000000000d','d@t'),('00000000-0000-0000-0000-00000000000e','e@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
SELECT pg_temp.expect('seeded plans', (SELECT count(*) FROM plans)::text, '3');
SELECT pg_temp.expect('no subscription is free', public.effective_client_plan('00000000-0000-0000-0000-00000000000a'), 'free');
INSERT INTO subscriptions(user_id,plan,status,valid_until) VALUES ('00000000-0000-0000-0000-00000000000b','pro','active',now()+interval '10 days');
SELECT pg_temp.expect('paid active is pro', public.effective_client_plan('00000000-0000-0000-0000-00000000000b'), 'pro');
INSERT INTO subscriptions(user_id,plan,status,valid_until) VALUES ('00000000-0000-0000-0000-00000000000c','pro','active',now()-interval '1 day');
SELECT pg_temp.expect('expired is free', public.effective_client_plan('00000000-0000-0000-0000-00000000000c'), 'free');
INSERT INTO subscriptions(user_id,plan,status,pro_provisional_until) VALUES ('00000000-0000-0000-0000-00000000000d','free','pending',now()+interval '5 hours');
SELECT pg_temp.expect('provisional is pro', public.effective_client_plan('00000000-0000-0000-0000-00000000000d'), 'pro');
SELECT pg_temp.expect('pro AI limit', public.entitlements_for('00000000-0000-0000-0000-00000000000b')->'entitlements'->>'ai_daily_limit', '200');
SELECT pg_temp.expect('free AI limit', public.entitlements_for('00000000-0000-0000-0000-00000000000a')->'entitlements'->>'ai_daily_limit', '5');
INSERT INTO coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000e','Coach Eee','active');
INSERT INTO coach_client_relationships(coach_id,client_id,status,share_scope) VALUES ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-00000000000a','active','{}');
SELECT pg_temp.expect('seats used', public.coach_seats('00000000-0000-0000-0000-00000000000e')->>'used', '1');
SELECT pg_temp.expect('no cap by default', (public.coach_seats('00000000-0000-0000-0000-00000000000e')->'cap')::text, 'null');
UPDATE plans SET entitlements = '{"max_clients":1}' WHERE key='coach_standard';
SELECT pg_temp.expect('cap after edit', public.coach_seats('00000000-0000-0000-0000-00000000000e')->>'cap', '1');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('person sees own plan', public.my_entitlements()->>'plan', 'pro');
DO $$ BEGIN
  BEGIN PERFORM public.entitlements_for('00000000-0000-0000-0000-00000000000a'); RAISE NOTICE 'FAIL : read someone else plan';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : cannot ask about another person'; END;
  BEGIN UPDATE plans SET name='Hacked'; IF FOUND THEN RAISE NOTICE 'FAIL : edited a plan'; ELSE RAISE NOTICE 'PASS : cannot edit plans'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : cannot edit plans'; END;
  BEGIN INSERT INTO plans(key,audience,name,entitlements) VALUES ('evil','client','x','[]'); RAISE NOTICE 'FAIL : inserted plan';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS : cannot add plans'; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN INSERT INTO plans(key,audience,name,price_inr_month) VALUES ('neg','client','x',-5); RAISE NOTICE 'FAIL : negative price';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS : negative price blocked'; END;
END $$;
