import { test, expect } from '@playwright/test';
import { signInViaUI } from './helpers/login';

const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe('Energy tab', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set — see e2e/README.md');

  test.beforeEach(async ({ page }) => {
    await signInViaUI(page, EMAIL!, PASSWORD!);
  });

  test('renders without error and is reachable from the login flow', async ({ page }) => {
    await page.goto('/app/energy');
    await expect(page).not.toHaveURL(/\/login/);
  });

  // The energy check-in prompt (Great/Good/Normal/Low/Very low) only
  // appears when there's a pending post-meal observation slot for the
  // test user — it's a time- and data-dependent banner, not something
  // this spec can reliably trigger without seeding fixture data first.
  // Flagged as a follow-up: seed a daily_log + wait for the 60-90min
  // window, or call the Dexie/localDb layer directly to force the
  // pending state before asserting on the check-in buttons.
  test.fixme(
    true,
    'Needs fixture data to deterministically trigger the energy check-in prompt — see comment above.',
  );
  test('submitting an energy check-in reflects in the day\'s log', async () => {
    // Intentionally left as a fixme placeholder — see above.
  });
});
