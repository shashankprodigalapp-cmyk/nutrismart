-- OPTIONAL. Makes YOUR real account a coach of 24 simulated clients, so you can see them on the Coach dashboard
-- (it shows a mix of on track, drifting, needs attention, silent, paused, and different sharing choices).
-- 1. Change the email on the line marked  <== YOUR EMAIL  to the email you log in with.
-- 2. Run in the Supabase SQL Editor after 01_seed_100.sql. It can be removed by 03_cleanup.sql (the links go with the sim clients).
DO $link$
DECLARE
  my_email TEXT := 'PUT_YOUR_EMAIL_HERE';   -- <== YOUR EMAIL (keep the quotes)
  me UUID; n INT := 0; r RECORD;
BEGIN
  SELECT id INTO me FROM auth.users WHERE lower(email) = lower(my_email) AND email NOT LIKE '%@sim.nutrismart.invalid';
  IF me IS NULL THEN RAISE EXCEPTION 'No account with that email. Edit my_email at the top of this script.'; END IF;
  INSERT INTO public.coach_profiles (user_id, display_name, credentials, status, approved_at)
  VALUES (me, COALESCE((SELECT NULLIF(name, '') FROM public.users WHERE id = me), 'My coach profile'), 'Simulation test', 'active', now())
  ON CONFLICT (user_id) DO UPDATE SET status = 'active';
  -- one or two clients from each behaviour type, so every status shows up
  FOR r IN
    SELECT u.id FROM public.users u
     WHERE u.email LIKE 'p%@sim.nutrismart.invalid'
       AND substring(u.email from 2 for 3)::int IN (1,2,16,17,24,25,32,33,40,41,42,50,51,58,59,66,70,71,76,77,82,83,84,94)
  LOOP
    INSERT INTO public.coach_client_relationships (coach_id, client_id, status, share_scope, invited_at, accepted_at)
    VALUES (me, r.id, 'active', '{"food":true,"energy":true,"water":true,"weight":true,"mood":true}', now() - interval '9 days', now() - interval '8 days')
    ON CONFLICT DO NOTHING;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Linked % simulated clients to you. Open the Coach area.', n;
END
$link$;
