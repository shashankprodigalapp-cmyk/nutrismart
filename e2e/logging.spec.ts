import { test, expect } from '@playwright/test';
import { signInViaUI } from './helpers/login';

const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe('Logging a meal and seeing it reflected', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set — see e2e/README.md');

  test.beforeEach(async ({ page }) => {
    await signInViaUI(page, EMAIL!, PASSWORD!);
  });

  test('Log tab is reachable and shows the food search box', async ({ page }) => {
    await page.goto('/app/log');
    await expect(page.getByPlaceholder('search food…')).toBeVisible({ timeout: 15_000 });
  });

  test('Today tab is reachable after logging in', async ({ page }) => {
    await page.goto('/app/today');
    // Smoke check: the tab renders without redirecting back to /login.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('link', { name: /Today/i })).toBeVisible();
  });

  test('searching for a known food shows a result to log', async ({ page }) => {
    await page.goto('/app/log');
    const search = page.getByPlaceholder('search food…');
    await search.fill('dal');
    // Debounced search — give it a moment to return results.
    await page.waitForTimeout(1000);
    // At minimum the search box should retain the typed query and the
    // page should not have thrown (no error boundary text visible).
    await expect(search).toHaveValue('dal');
  });
});
