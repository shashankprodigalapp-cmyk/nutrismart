import { test, expect } from '@playwright/test';
import { signInViaUI } from './helpers/login';

const ADMIN_EMAIL = process.env.ADMIN_TEST_USER_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_TEST_USER_PASSWORD;

test.describe('Admin dashboard', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'ADMIN_TEST_USER_EMAIL / ADMIN_TEST_USER_PASSWORD not set — most CI runs will skip this. See e2e/README.md.',
  );

  test('an admin user can load the analytics dashboard', async ({ page }) => {
    await signInViaUI(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/app/admin');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/analytics|dashboard/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('a non-admin user is redirected away from /app/admin', async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;
    test.skip(!email || !password, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set');
    await signInViaUI(page, email!, password!);
    await page.goto('/app/admin');
    await expect(page).not.toHaveURL(/\/app\/admin$/);
  });
});
