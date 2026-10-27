-- Admin platform test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','a@t'),('00000000-0000-0000-0000-00000000000b','b@t'),('00000000-0000-0000-0000-00000000000c','c@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000b','Coach Bee','active'),('00000000-0000-0000-0000-00000000000c','Coach Cee','pending');
INSERT INTO public.coach_client_relationships(coach_id,client_id,status,share_scope) VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','active','{"food":true}');
SELECT pg_temp.expect('total users', (public.admin_platform_metrics()->'users'->>'total')::bigint, 3);
SELECT pg_temp.expect('active coaches', (public.admin_platform_metrics()->'coaches'->>'active')::bigint, 1);
SELECT pg_temp.expect('pending coaches', (public.admin_platform_metrics()->'coaches'->>'pending')::bigint, 1);
SELECT pg_temp.expect('active coached clients', (public.admin_platform_metrics()->'coaches'->>'active_clients')::bigint, 1);
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.admin_platform_metrics(); RAISE NOTICE 'FAIL : signed-in user read admin numbers';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : signed-in user cannot read admin numbers'; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.admin_platform_metrics(); RAISE NOTICE 'FAIL : anonymous read admin numbers';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : anonymous cannot read admin numbers'; END;
END $$;
RESET ROLE;
