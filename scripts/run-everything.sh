#!/usr/bin/env bash
# One command that runs the fast automated checks, and optionally the live browser run. (Not the same as scripts/test-all.sh, which CI uses for the scratch database and the 100-person simulation.)
#   ./scripts/run-everything.sh            -> unit/contract tests + build (about 1 minute, no network)
#   ./scripts/run-everything.sh --live     -> the above + the full API/browser run against the preview
# The live run needs BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in the environment.
set -u
cd "$(dirname "$0")/.."
LIVE=0; [ "${1:-}" = "--live" ] && LIVE=1
FAIL=0; ROWS=()
step() { local name="$1"; shift; echo; echo "=== $name"; if "$@"; then ROWS+=("PASS  $name"); else ROWS+=("FAIL  $name"); FAIL=1; fi; }
step "1  Unit, component, blueprint contract and browser-selector contract" npx vitest run
step "2  Type check and production build" npm run build
if [ "$LIVE" = "1" ]; then
  if [ -z "${BASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    echo "Live run needs BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY."; ROWS+=("FAIL  3  Live run (secrets missing)"); FAIL=1
  else
    step "3  Live: API + security + screens + workflows (all of e2e/v2)" npx playwright test e2e/v2
  fi
fi
echo; echo "================ SUMMARY"; printf '%s\n' "${ROWS[@]}"
[ "$FAIL" = "0" ] && echo "ALL GREEN" || echo "SOMETHING FAILED"
exit $FAIL
