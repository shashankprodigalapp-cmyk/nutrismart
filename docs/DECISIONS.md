# Decisions

1. **1.0 safe point** is git tag `v1.0`; 2.0 lives on branch `v2` and deploys to a Cloudflare preview. Production stays on `main`.
2. **Additive migrations only**, one shared Supabase database for 1.0 and 2.0.
3. **Reuse existing tables** instead of creating the spec's duplicates (see DATABASE.md mapping).
4. **Roles are derived on the server** from `coach_profiles` and `admin_users`. A browser-sent role is never read.
5. **Coaches are approved by an admin** by default (`v2_coach_auto_approve` off). Sign-up is closed until `v2_coach_signup` is on.
6. **Client controls sharing.** Coach access requires the client's accept action and is limited to the scopes they allow; they can pause or leave at any time.
7. **Invite tokens** are random, shown once, stored only as SHA-256 hash, expire in 14 days, single use.
8. **Timeline triggers swallow their own errors** so food, energy and water logging can never fail because of the timeline.
9. **Testing in a sandbox without full node_modules:** `scripts/run-tests-lite.mjs` runs vitest-style tests; CI remains the source of truth for tsc/vitest/build.
10. **Name:** product name is under review (conflict with an existing app); keep it in one place.
