import { test, expect } from '@playwright/test';

const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe('Login', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set — see e2e/README.md');

  test('signs in with email/password and reaches the app shell', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByText('nutrismart')).toBeVisible();

    await page.getByPlaceholder('Email address').fill(EMAIL!);
    await page.getByPlaceholder('Password (min 8 chars)').fill(PASSWORD!);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Successful login redirects into /app/* (defaults to /app/log).
    await page.waitForURL(/\/app\//, { timeout: 15_000 });
  });

  test('shows an error on invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.getByPlaceholder('Email address').fill('not-a-real-user@example.com');
    await page.getByPlaceholder('Password (min 8 chars)').fill('wrong-password-123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.locator('p.text-\\[\\#FF6B6B\\]')).toBeVisible({ timeout: 10_000 });
  });
});
