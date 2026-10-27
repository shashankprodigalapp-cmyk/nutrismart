-- Security test. Scratch database only. Every line must say PASS.
CREATE OR REPLACE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE NOTICE '% : % (got %, want %)', CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END, label, got, want; END $$;
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000a','a@t'),('00000000-0000-0000-0000-00000000000b','b@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
-- A (client) and B (coach) with data on both sides
INSERT INTO coach_profiles(user_id,display_name,status) VALUES ('00000000-0000-0000-0000-00000000000b','Coach Bee','active');
INSERT INTO coach_client_relationships(coach_id,client_id,status,share_scope,ended_by) VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','ended','{}','00000000-0000-0000-0000-00000000000b');
INSERT INTO daily_checkins(user_id,log_date,mood) VALUES ('00000000-0000-0000-0000-00000000000a',current_date,3);
INSERT INTO experiments(user_id,template,title,actions,metrics,start_date,duration_days) VALUES ('00000000-0000-0000-0000-00000000000a','t','Test experiment','["a"]','["mood"]',current_date,7);
INSERT INTO nudge_preferences(user_id,log_reminders) VALUES ('00000000-0000-0000-0000-00000000000a',true);
INSERT INTO nudges(user_id,kind,sent_by,title,body,dedupe_key) VALUES ('00000000-0000-0000-0000-00000000000a','coach_message','00000000-0000-0000-0000-00000000000b','t','hello','k1');
INSERT INTO ai_weekly_reviews(user_id,week_start,data_hash,source,status,decided_by) VALUES ('00000000-0000-0000-0000-00000000000a',current_date,'h','rules','approved','00000000-0000-0000-0000-00000000000b');
INSERT INTO audit_logs(actor_id,actor_role,action,target_user,meta) VALUES
 ('00000000-0000-0000-0000-00000000000b','coach','review_decided','00000000-0000-0000-0000-00000000000a','{"client":"00000000-0000-0000-0000-00000000000a"}'),
 ('00000000-0000-0000-0000-00000000000a','client','invite_accepted','00000000-0000-0000-0000-00000000000a','{}');

-- Deleting the COACH: the client keeps their data, the coach's id disappears from rows that stay
SELECT public.erase_user_traces('00000000-0000-0000-0000-00000000000b');
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000000b';
SELECT pg_temp.expect('client keeps own check-in after coach deleted', (SELECT count(*) FROM daily_checkins)::text, '1');
SELECT pg_temp.expect('review no longer names the coach', (SELECT count(*) FROM ai_weekly_reviews WHERE decided_by IS NOT NULL)::text, '0');
SELECT pg_temp.expect('audit rows stay but name nobody', (SELECT count(*) FROM audit_logs WHERE actor_id IS NOT NULL AND actor_role='coach')::text, '0');
SELECT pg_temp.expect('audit details naming the client are cleared when client is erased', (SELECT count(*) FROM audit_logs)::text, '2');

-- Deleting the CLIENT: nothing about them remains anywhere
SELECT public.erase_user_traces('00000000-0000-0000-0000-00000000000a');
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000000a';
DO $$ DECLARE r record; n bigint; leftover text := ''; checked int := 0;
BEGIN
  FOR r IN SELECT c.conrelid::regclass AS t, a.attname AS col
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
           WHERE c.contype = 'f' AND c.confrelid IN ('public.users'::regclass) AND c.conrelid::regclass::text <> 'users'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (%L, %L)', r.t, r.col, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b') INTO n;
    checked := checked + 1;
    IF n > 0 THEN leftover := leftover || r.t || '.' || r.col || '(' || n || ') '; END IF;
  END LOOP;
  IF leftover = '' THEN RAISE NOTICE 'PASS : no row in any of % user-linked columns still names a deleted person', checked;
  ELSE RAISE NOTICE 'FAIL : leftovers %', leftover; END IF;
END $$;
SELECT pg_temp.expect('audit log has no id of deleted people', (SELECT count(*) FROM audit_logs WHERE actor_id IS NOT NULL OR target_user IS NOT NULL OR meta::text LIKE '%00000000-0000-0000-0000-00000000000a%')::text, '0');

-- Rate limits
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000c','c@t'); INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
SELECT pg_temp.expect('first hits allowed', (public.v2_hit('00000000-0000-0000-0000-00000000000c','t_a',3600,2)->>'allowed'), 'true');
SELECT public.v2_hit('00000000-0000-0000-0000-00000000000c','t_a',3600,2);
SELECT pg_temp.expect('third hit blocked', (public.v2_hit('00000000-0000-0000-0000-00000000000c','t_a',3600,2)->>'allowed'), 'false');
SELECT pg_temp.expect('other bucket unaffected', (public.v2_hit('00000000-0000-0000-0000-00000000000c','t_b',3600,2)->>'allowed'), 'true');
SELECT pg_temp.expect('retry_after is within the window', (SELECT ((public.v2_hit('00000000-0000-0000-0000-00000000000c','t_a',3600,2)->>'retry_after')::int BETWEEN 1 AND 3600)::text), 'true');
DO $$ BEGIN
  BEGIN PERFORM public.v2_hit('00000000-0000-0000-0000-00000000000c','x',0,1); RAISE NOTICE 'FAIL : zero window accepted';
  EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASS : bad window rejected'; END;
END $$;
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
DO $$ BEGIN
  BEGIN PERFORM public.v2_hit('00000000-0000-0000-0000-00000000000c','t_a',60,100); RAISE NOTICE 'FAIL : app called rate limiter';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : app cannot call the rate limiter'; END;
  BEGIN PERFORM public.erase_user_traces('00000000-0000-0000-0000-00000000000c'); RAISE NOTICE 'FAIL : app called erase';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : app cannot call erase_user_traces'; END;
  BEGIN PERFORM count(*) FROM v2_rate_limits; RAISE NOTICE 'PASS : counter table shows nothing to the app';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : counter table closed to the app'; END;
END $$;
SELECT pg_temp.expect('counter rows visible to the app', (SELECT count(*) FROM v2_rate_limits)::text, '0');
RESET ROLE;

-- ── Audit fixes in 1.0 functions ──────────────────────────────────────────
TRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000a1','admin@t'),('00000000-0000-0000-0000-0000000000b1','user@t'),('00000000-0000-0000-0000-0000000000b2','other@t');
INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;
INSERT INTO admin_users(user_id,role) VALUES ('00000000-0000-0000-0000-0000000000a1','super_admin');
SELECT pg_temp.expect('postgres with no login is not an admin by id alone', public.is_admin('00000000-0000-0000-0000-0000000000a1')::text, 'false');
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1'; SET request.jwt.claim.role = 'authenticated';
SELECT pg_temp.expect('admin signed in as themselves is admin', public.is_admin('00000000-0000-0000-0000-0000000000a1')::text, 'true');
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('user passing an admin id is NOT admin', public.is_admin('00000000-0000-0000-0000-0000000000a1')::text, 'false');
SELECT pg_temp.expect('non-admin is not admin', public.is_admin('00000000-0000-0000-0000-0000000000b1')::text, 'false');
SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
SELECT pg_temp.expect('server (service role) may check an admin', public.is_admin('00000000-0000-0000-0000-0000000000a1')::text, 'true');
SET request.jwt.claim.role = 'anon';
SELECT pg_temp.expect('anonymous passing an admin id is NOT admin', public.is_admin('00000000-0000-0000-0000-0000000000a1')::text, 'false');
-- A real admin action: a user posing as the admin is refused, the admin and the server succeed
SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
DO $$ BEGIN
  DECLARE r jsonb; BEGIN
    r := public.grant_free_pro('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1',30,'x');
    IF COALESCE((r->>'success')::boolean, false) THEN RAISE NOTICE 'FAIL : user posed as admin and gifted Pro'; ELSE RAISE NOTICE 'PASS : user posing as admin refused'; END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS : user posing as admin refused (error)'; END;
  BEGIN PERFORM public.grant_provisional_pro('00000000-0000-0000-0000-0000000000b1', 8760); RAISE NOTICE 'FAIL : user gave themselves provisional Pro';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : user cannot grant themselves provisional Pro'; END;
  BEGIN PERFORM public.revoke_provisional_pro('00000000-0000-0000-0000-0000000000b2'); RAISE NOTICE 'FAIL : user revoked someone else';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : user cannot revoke another person'; END;
  BEGIN PERFORM public.increment_rate_limit('00000000-0000-0000-0000-0000000000b2', now(), 5); RAISE NOTICE 'FAIL : user burned another persons allowance';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : user cannot touch another persons AI allowance'; END;
  BEGIN PERFORM public.get_user_percentile('00000000-0000-0000-0000-0000000000b2', current_date); RAISE NOTICE 'FAIL : read another persons percentile';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : user cannot read another persons percentile'; END;
  BEGIN PERFORM public.kitchen_impact_analysis('00000000-0000-0000-0000-0000000000b2', 60); RAISE NOTICE 'FAIL : read another persons kitchen analysis';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS : user cannot read another persons kitchen analysis'; END;
  BEGIN PERFORM public.kitchen_impact_analysis('00000000-0000-0000-0000-0000000000b1', 60); RAISE NOTICE 'PASS : user can read own kitchen analysis';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL : own kitchen analysis refused (%)', SQLERRM; END;
END $$;
RESET ROLE; SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1'; SET request.jwt.claim.role = 'authenticated';
DO $$ DECLARE r jsonb; BEGIN
  r := public.grant_free_pro('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1',30,'gift');
  IF (r->>'success')::boolean THEN RAISE NOTICE 'PASS : real admin can still gift Pro'; ELSE RAISE NOTICE 'FAIL : admin gift failed %', r; END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL : admin gift raised %', SQLERRM; END $$;
SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
SELECT pg_temp.expect('server can still grant provisional Pro', (public.grant_provisional_pro('00000000-0000-0000-0000-0000000000b2', 24)->>'success'), 'true');
RESET request.jwt.claim.role;
