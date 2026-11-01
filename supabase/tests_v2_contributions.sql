-- Admin can read contributions; an ordinary person sees only their own. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','a@t'),('00000000-0000-0000-0000-00000000000b','b@t'),('00000000-0000-0000-0000-00000000000c','c@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO public.admin_users(user_id,role) VALUES ('00000000-0000-0000-0000-00000000000c','super_admin');
INSERT INTO public.food_contributions(user_id,payload,status) VALUES ('00000000-0000-0000-0000-00000000000a','{"name":"x"}','pending'),('00000000-0000-0000-0000-00000000000b','{"name":"y"}','pending');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect('a person sees only their own contribution', (SELECT count(*) FROM public.food_contributions), 1);
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect('an admin sees every contribution', (SELECT count(*) FROM public.food_contributions), 2);
RESET ROLE;
