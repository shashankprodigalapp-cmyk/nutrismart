-- Removes every simulated person and everything they own (meals, check-ins, reviews, experiments, coach links, plans, nudges).
-- Only touches people whose email ends @sim.nutrismart.invalid. Real accounts are not touched.
DO $clean$
DECLARE n_before INT; n_after INT; leftovers INT;
BEGIN
  SELECT COUNT(*) INTO n_before FROM auth.users WHERE email LIKE '%@sim.nutrismart.invalid';
  -- rows that name a person without being deleted with them
  DELETE FROM public.audit_logs WHERE actor_id IN (SELECT id FROM auth.users WHERE email LIKE '%@sim.nutrismart.invalid')
                                   OR target_user IN (SELECT id FROM auth.users WHERE email LIKE '%@sim.nutrismart.invalid');
  DELETE FROM auth.users WHERE email LIKE '%@sim.nutrismart.invalid';
  SELECT COUNT(*) INTO n_after FROM auth.users WHERE email LIKE '%@sim.nutrismart.invalid';
  SELECT COUNT(*) INTO leftovers FROM public.users WHERE email LIKE '%@sim.nutrismart.invalid';
  RAISE NOTICE 'Removed % simulated accounts. Remaining: % (should be 0). Leftover profiles: % (should be 0).', n_before, n_after, leftovers;
END
$clean$;
