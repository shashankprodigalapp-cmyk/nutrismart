import { defineConfig, devices } from '@playwright/test';

/**
 * Layer C e2e config. Runs against the live deployment by default
 * (BASE_URL), not a local dev server — Cloudflare Pages Functions aren't
 * trivially reproducible locally, so "staging == production" here.
 * See e2e/README.md for required env vars and what's covered.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'https://nutrismart-3bb.pages.dev',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
