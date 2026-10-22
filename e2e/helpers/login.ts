import type { Page } from '@playwright/test';

/**
 * Shared login helper for e2e specs. Signs in via the real UI (not an API
 * shortcut) so every spec that uses it also incidentally re-verifies the
 * login form itself.
 */
export async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password (min 8 chars)').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/\/app\//, { timeout: 15_000 });
}
