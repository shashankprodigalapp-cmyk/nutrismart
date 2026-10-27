# Testing
- Unit: `npm test` (vitest). In a sandbox without full node_modules: `node scripts/run-tests-lite.mjs <test files>`.
- Database/RLS: create a scratch Postgres with the Supabase stubs, apply migrations 001-020, run `supabase/tests_v2_rls.sql`; every line must say PASS.
- 2.0 tests live in `src/tests/v2/`.
