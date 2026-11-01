-- 039: let admins READ food contributions.
-- Found by the browser test W-10: the admin Contributions screen reads this table with the admin's own sign-in,
-- but the only read rule let a person see their OWN submissions. So an admin saw "No pending contributions" and could never approve or reject.
-- Additive and safe for 1.0: it only widens reading, for admins only. Writes still go through the approve/reject functions.
DROP POLICY IF EXISTS "food_contributions_select_admin" ON public.food_contributions;
CREATE POLICY "food_contributions_select_admin"
  ON public.food_contributions
  FOR SELECT
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())));
