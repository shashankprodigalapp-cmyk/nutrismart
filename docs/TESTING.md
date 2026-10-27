# Testing
- Unit: `npm test` (vitest). In a sandbox without full node_modules: `node scripts/run-tests-lite.mjs <test files>`.
- Database/RLS: create a scratch Postgres with the Supabase stubs, apply migrations 001-020, run `supabase/tests_v2_rls.sql`; every line must say PASS.
- 2.0 tests live in `src/tests/v2/`.

## Everything in one go (added in Phase 20)
- Unit tests: `npm test`. Without full node_modules: `node scripts/run-tests-lite.mjs src/tests/v2/*.test.ts`.
- Database: `PGHOST=... PGUSER=... scripts/db-test.sh` builds a scratch database, applies every migration and runs every SQL test (180 checks). Never point it at the real database.
- Deployed copy: `node scripts/smoke-v2.mjs <address>` (no side effects).
- GitHub runs unit, build, database and the smoke test automatically (workflow "2.0 checks").
- By hand on a phone: MANUAL_TESTS.md.
