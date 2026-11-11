// Phone-size check: opens key screens at real phone sizes and writes what it finds to test-results/phone-matrix.json.
// Runs inside the existing CI (npx playwright test e2e/v2). Needs the same shared test accounts as screens.spec.ts.
import { test, expect, Browser } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE, configured, ensureUser, PASSWORD } from './env';

const DEVICES = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'Pixel 7', width: 412, height: 915 },
  { name: 'Small Android 360', width: 360, height: 740 },
];
const SCREENS = ['/app', '/app/log', '/app/insights', '/app/wrap', '/app/plate-poster', '/app/journey'];
const findings: Array<Record<string, unknown>> = [];

test.describe('phone matrix', () => {
  test.skip(!configured, 'test accounts not configured');
  let email = '';
  test.beforeAll(async () => { email = (await ensureUser('client')).email; });

  async function open(browser: Browser, d: typeof DEVICES[number], dark: boolean, bigText: boolean) {
    const ctx = await browser.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: dark ? 'dark' : 'light' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByPlaceholder('Email address').fill(email);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).first().click();
    await page.waitForURL(/\/app|\/onboarding/, { timeout: 30000 });
    if (bigText) await page.addStyleTag({ content: 'html{font-size:200% !important}' });
    return { ctx, page };
  }

  for (const d of DEVICES) for (const mode of [{ dark: false, big: false, tag: 'light' }, { dark: true, big: false, tag: 'dark' }, { dark: false, big: true, tag: 'big-text' }]) {
    test(`${d.name} ${mode.tag}`, async ({ browser }) => {
      test.setTimeout(180000);
      const { ctx, page } = await open(browser, d, mode.dark, mode.big);
      for (const path of SCREENS) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const sideways = document.documentElement.scrollWidth - vw;
          const small = [...document.querySelectorAll('button,a[href],[role=button],input,select')].filter(e => { const b = (e as HTMLElement).getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.height < 40 || b.width < 40); }).length;
          const unnamed = [...document.querySelectorAll('button')].filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
          const clipped = [...document.querySelectorAll('h1,h2,p,button')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1); }).length;
          return { sideways, small, unnamed, clipped, error: /something went wrong|application error/i.test(document.body.innerText) };
        });
        findings.push({ device: d.name, mode: mode.tag, path, ...r });
        if (!mode.big) await page.screenshot({ path: `test-results/phone/${d.name.replace(/ /g, '-')}-${mode.tag}-${path.replace(/\//g, '_')}.png` });
        expect.soft(r.error, `${d.name} ${path} shows an error page`).toBe(false);
        expect.soft(r.sideways, `${d.name} ${mode.tag} ${path} scrolls sideways`).toBeLessThanOrEqual(1);
        expect.soft(r.unnamed, `${d.name} ${path} has unnamed buttons`).toBe(0);
      }
      await ctx.close();
    });
  }
  test.afterAll(() => { mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/phone-matrix.json', JSON.stringify({ when: new Date().toISOString(), findings }, null, 2)); });
});
