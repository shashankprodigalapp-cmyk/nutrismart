# Live integration tests (Layer B)

These tests hit the **real, deployed** Cloudflare Pages Functions at
`BASE_URL` (default `https://nutrismart-3bb.pages.dev`) using a real
Supabase-authenticated test user. They are **not** part of `npm test` /
the default Vitest run (unit tests, mocked, no network) — they're a
separate Vitest project so they never silently run in CI on every PR
against production data.

## Why these exist

The unit tests in `src/tests/**` mock Supabase, Gemini, etc. They catch
logic bugs but never prove the deployed Cloudflare Function actually
boots, reads its env vars correctly, and talks to the real Supabase
instance. This suite closes that gap.

## Setup

1. Create a dedicated **test user** in the Supabase project (not a real
   person's account) — sign up once via the app or the Supabase dashboard,
   e.g. `nutrismart-integration-test@example.com`.
2. Export the required env vars (never commit these):

   ```bash
   export BASE_URL=https://nutrismart-3bb.pages.dev
   export VITE_SUPABASE_URL=...        # same as the app's anon-key URL
   export VITE_SUPABASE_ANON_KEY=...   # anon key, safe client-side value
   export TEST_USER_EMAIL=nutrismart-integration-test@example.com
   export TEST_USER_PASSWORD=...
   ```

3. Run:

   ```bash
   npx vitest run --config tests-integration/vitest.integration.config.ts
   ```

## What's covered

- Auth: a request with no/garbage `Authorization` header is rejected (401)
  on every endpoint that requires it.
- CORS: `OPTIONS` preflight returns the expected `Access-Control-Allow-*`
  headers.
- Happy path smoke for the endpoints safe to call repeatedly in CI without
  side effects on real data: `get-upload-url`, `analyze-energy`,
  `cron-morning-verdict` (GET).
- Endpoints with side effects (`submit-payment`, `promote-food-cache`,
  `razorpay-webhook`) are intentionally **not** exercised here to avoid
  polluting production data — see the cron smoke-test script and manual
  QA checklist for those instead.

## CI wiring

See `.github/workflows/integration.yml` — runs on a schedule and manually
via `workflow_dispatch`, using repository secrets for the values above.
It deliberately does **not** run on every PR (it would be slow, and a
flaky network blip would block unrelated PRs).
