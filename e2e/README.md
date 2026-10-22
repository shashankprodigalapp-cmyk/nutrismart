# End-to-end browser tests (Layer C)

[Playwright](https://playwright.dev) specs that drive the real deployed
app in a real browser. Run against `BASE_URL` (default
`https://nutrismart-3bb.pages.dev`).

## Setup

```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

Env vars (same dedicated test user as the integration tests — never a
real person's account):

```bash
export BASE_URL=https://nutrismart-3bb.pages.dev
export TEST_USER_EMAIL=nutrismart-integration-test@example.com
export TEST_USER_PASSWORD=...
```

## Run

```bash
npx playwright test
npx playwright test --headed       # watch it run locally
npx playwright show-report         # after a CI run
```

## What's covered

- `auth.spec.ts` — login with the test user, redirected into the app shell.
- `logging.spec.ts` — log a meal manually from the Log tab, see it appear
  on the Today tab.
- `energy.spec.ts` — submit an energy check-in, see it reflected in the
  Energy tab.
- `admin.spec.ts` — skipped unless `ADMIN_TEST_USER_EMAIL` /
  `ADMIN_TEST_USER_PASSWORD` are set (most CI runs won't have an admin
  test account provisioned; this keeps the suite green by default while
  still being runnable where it matters).

## What's intentionally NOT covered yet

- The UPI payment flow (`UpiPaymentFlow.tsx`) — it uploads a real
  screenshot and calls Gemini Vision; needs a fixture image and a sandbox
  Razorpay/UPI flow decision before it's safe to automate against
  production. Flagged in the test-plan doc as a follow-up.
- Photo-based meal logging (camera capture) — Playwright can feed a fake
  camera stream, but needs a fixture video; follow-up once the manual-
  logging flow above is green in CI.
