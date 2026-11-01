#!/usr/bin/env bash
# One command, no manual steps: unit tests, database migrations + SQL tests, then the 100-person simulation
# (seed, 79-check scorecard, app-rule checks, test mode on/off, cleanup) on a scratch database.
# Never touches the real Supabase. Needs local Postgres (PGHOST/PGPORT/PGUSER/PGPASSWORD) and Node.
#   Usage: scripts/test-all.sh
set -u
cd "$(dirname "$0")/.."
fail=0
echo "== 1. App unit tests =="; npm test --silent || fail=1
echo "== 2. Database migrations and SQL tests =="; scripts/db-test.sh || fail=1
export PGDATABASE=nutrismart_test
Q="psql -q -v ON_ERROR_STOP=1 -d $PGDATABASE"
echo "== 3. Simulation: seed 100 people =="; $Q -f supabase/sim/01_seed_100.sql >/dev/null || fail=1
echo "== 4. Simulation: scorecard =="
out=$(psql -At -d $PGDATABASE -f supabase/sim/04_scorecard.sql 2>&1); echo "$out" | grep -E "TOTAL|FAIL|ERROR" | head -20
echo "$out" | grep -qE "FAIL|ERROR" && fail=1
echo "== 5. Simulation: app-rule checks =="; node scripts/sim/ts-checks.mjs | grep -E "FAIL|passed" ; [ "${PIPESTATUS[0]}" = 0 ] || fail=1
echo "== 6. Test mode on, then off restores =="
before=$(psql -At -d $PGDATABASE -c "select count(*) from feature_flags where enabled")
$Q -f supabase/sim/05_test_mode_on.sql >/dev/null; total=$(psql -At -d $PGDATABASE -c "select count(*) from feature_flags where not enabled")
$Q -f supabase/sim/06_test_mode_off.sql >/dev/null; after=$(psql -At -d $PGDATABASE -c "select count(*) from feature_flags where enabled")
[ "$total" = 0 ] && [ "$before" = "$after" ] && echo "PASS test mode on/off" || { echo "FAIL test mode on/off"; fail=1; }
echo "== 7. Cleanup removes everyone =="; $Q -f supabase/sim/03_cleanup.sql >/dev/null
left=$(psql -At -d $PGDATABASE -c "select count(*) from auth.users where email like '%@sim.nutrismart.invalid'")
[ "$left" = 0 ] && echo "PASS cleanup" || { echo "FAIL cleanup ($left left)"; fail=1; }
[ "$fail" = 0 ] && echo "ALL AUTOMATED TESTS PASSED" || echo "SOME TESTS FAILED"
exit $fail
