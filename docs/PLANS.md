# Plans and subscriptions (Phase 17)

## What exists
- `plans` table (migration 034): key, audience (client or coach), name, monthly and yearly rupee price, `entitlements` (AI searches per day, coach client cap, feature list), on/off, order. Seeded: free, pro (₹99), coach_standard (no cap).
- `effective_client_plan(user)`: same rule as `proGatekeeper.ts` (paid, active, not expired, or a live provisional window).
- `my_entitlements()` for the signed-in person; `entitlements_for(user)` and `coach_seats(coach)` for the server only.
- `coach_profiles.plan_key` (default coach_standard).
- Endpoints: `GET /api/plans` (active client plans plus your own), `GET/POST /api/admin-plans` (admin, audited as plan_created / plan_updated).
- Admin: Platform 2.0, Plans.

## What is enforced
Only one thing: when the `v2_plans` switch is ON, a client cannot accept a coach whose plan client cap is full ("This coach is not taking new clients right now"). No cap means always allowed. Default is no cap, so nothing changes until you set one.

## What is NOT changed (on purpose, so 1.0 stays safe)
- The 1.0 payment flow and the ₹99 charged in `submit-payment.ts`.
- The AI search limits (5 free, 200 Pro) in `proGatekeeper.ts`. The catalog holds the same numbers but the app does not read them yet.
- No online card or recurring billing. Razorpay webhook code is untouched.

## To connect later (needs your decision)
Read price and AI limit from `plans` in `submit-payment` and the gatekeeper; yearly plans and a pricing page; coach plans with prices and billing.

## Tests
`Plans.test.ts` (12), `supabase/tests_v2_plans.sql` (15).
