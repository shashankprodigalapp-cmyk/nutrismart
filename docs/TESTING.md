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

## 2.1 additions
- Unit: `src/tests/intel21/*` (features, recommendations, notification decisions, energy/coach/reports, loop, security).
- Database: `supabase/tests_v2_intel.sql` (RLS, write refusal, check constraints) runs inside `scripts/db-test.sh`.
- Browser: `e2e/v21/intelligence.spec.ts` (runs with `npx playwright test e2e/v2`; skips with a message if migrations 041 to 043 are not applied). It switches the ten 2.1 switches on for the run and restores them.
- Guard: `E2eSelectors.test.ts` checks every heading and button name the spec uses exists in the app.
- Stories and phone checks: `docs/TEST_CASES_2_1.md`.

## Press-every-button suite and own-rows rule
- `e2e/v21/crawler.spec.ts` presses every visible button, tab and in-app link on every customer, coach and admin screen and fails on JS errors, error screens, 5xx, refused API calls, refused saves and stuck loading. Admin pressing is look-only.
- `src/tests/v2/OwnRowsOnly.test.ts` fails if any customer screen reads or changes a person-owned table without filtering by the signed-in person (the cause of the Birthday dinner Skipped / Cancel bug: coaches can read clients' rows, so unfiltered reads show clients' data).
- `node scripts/ui-inventory.mjs --md docs/UI_COVERAGE.md` lists every button, link, field and label and whether a browser test names it.
