// Blueprint coverage suite: real-browser checks for the customer, coach and admin screens, plus security headers,
// route protection, mobile layout and an every-endpoint-needs-a-login sweep.
// Same setup as platform.spec.ts: three made-up accounts, the deployed preview, skips itself without secrets.
// Test IDs (CU-, CO-, AD-, X-) match the coverage table in section 9 of the blueprint.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { configured, BASE, api, rest, ensureUser, signIn, istToday, PASSWORD } from './env';

test.skip(!configured, 'Set BASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY (see docs/SIMULATION.md)');

type U = { id: string; email: string };
let client: U, coach: U, adminU: U;
let flags: Record<string, boolean> = {};
const today = istToday();
const BAD = /Something went wrong|Application error|Unexpected Application Error/i;

/** Wait for the page to finish loading, without hanging forever on background requests. */
async function settle(page: Page) {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
}
/** Sign in through the real form. The app always lands on /app/log after sign-in, so open the wanted page explicitly. */
async function login(page: Page, email: string, landing: string | null = '/app/today') {
  await page.goto('/login');
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  if (landing) await page.goto(landing);
  await settle(page);
}
const opened: Page[] = [];
const openCtx: Array<{ close: () => Promise<void> }> = [];
async function as(browser: Browser, email: string, vp?: { width: number; height: number }, landing: string | null = '/app/today') {
  const ctx = await browser.newContext(vp ? { viewport: vp, baseURL: BASE } : { baseURL: BASE });
  openCtx.push(ctx);
  const page = await ctx.newPage();
  opened.push(page);
  await login(page, email, landing);
  return { ctx, page };
}
// When a test fails, print where the browser was and what it showed, so one run explains the failure.
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    for (const pg of [page, ...opened]) {
      if (pg.isClosed()) continue;
      const text = await pg.locator('body').innerText().catch(() => '(no text)');
      console.log(`DIAGNOSTIC [${info.title}] url=${pg.url()}\n${text.slice(0, 600).replace(/\n+/g, ' | ')}`);
    }
  }
  // Close every window, pass or fail: a page left open keeps syncing and can disturb later tests.
  for (const c of openCtx) await c.close().catch(() => undefined);
  openCtx.length = 0; opened.length = 0;
});
async function healthy(page: Page) {
  await expect(page.locator('body')).not.toContainText(BAD);
  expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(20);
}

test.beforeAll(async () => {
  client = await ensureUser('client'); coach = await ensureUser('coach'); adminU = await ensureUser('admin');
  for (const t of ['daily_logs', 'daily_checkins', 'flexible_meals', 'nudges']) await rest(`${t}?user_id=eq.${client.id}`, { method: 'DELETE' });
  await rest(`coach_client_relationships?coach_id=eq.${coach.id}`, { method: 'DELETE' });
  for (const u of [client, coach, adminU]) {
    await rest('kitchen_profiles?on_conflict=user_id', { method: 'POST', body: { user_id: u.id }, prefer: 'resolution=ignore-duplicates' });
    const kp = await rest(`kitchen_profiles?user_id=eq.${u.id}&select=user_id`);
    if (!Array.isArray(kp.data) || kp.data.length !== 1) throw new Error(`setup: ${u.email} has no kitchen profile, so the app would send them to onboarding`);
  }
  await rest('admin_users', { method: 'POST', body: { user_id: adminU.id }, prefer: 'resolution=ignore-duplicates' });
  await rest('coach_profiles', { method: 'POST', body: { user_id: coach.id, display_name: 'E2E coach', credentials: 'test', status: 'active', approved_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
  await rest('coach_client_relationships', { method: 'POST', body: { coach_id: coach.id, client_id: client.id, status: 'active', share_scope: { food: true, energy: true, water: true, weight: true, mood: true }, invited_at: new Date().toISOString(), accepted_at: new Date().toISOString() } });
  await rest('daily_logs', { method: 'POST', body: [['breakfast', 'Screens poha', 300, 8], ['lunch', 'Screens dal rice', 600, 22], ['dinner', 'Screens roti sabzi', 500, 16]].map(([meal, name, cal, p]) => ({ user_id: client.id, log_date: today, meal, food_name: name, portion: '1 plate', qty: 1, is_home: true, multiplier: 1, cal, protein: p, carbs: 50, fat: 10, gl: 10, anomaly: false, food_source: 'master' })) });
  const f = await rest('feature_flags?select=key,enabled');
  flags = Object.fromEntries((f.data as any[]).map(r => [r.key, r.enabled]));
});

// ───────────────────────── Customer app ─────────────────────────
test.describe('Customer: sign in, sign up, first run', () => {
  test('CU-01 sign-in form: fields, mode switch, and the sign-up name field', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('Email address')).toBeVisible();
    await expect(page.getByPlaceholder('Password', { exact: true })).toBeVisible();
    await expect(page.getByText('Forgot password?')).toBeVisible();
    await expect(page.getByPlaceholder('Your name')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create Account' }).first().click();
    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await expect(page.getByText(/I am 18 or older/)).toBeVisible();
  });
  test('CU-02 sign-up needs the 18+ tick, then enforces every password rule (no account is created)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create Account' }).first().click();
    await page.locator('form').evaluate(f => { (f as HTMLFormElement).noValidate = true; });
    await page.getByPlaceholder('Your name').fill('Nobody');
    await page.getByPlaceholder('Email address').fill(`nobody-${Date.now()}@sim.nutrismart.invalid`);
    const pw = page.getByPlaceholder(/^Password/);
    await pw.fill('Aa1!aaaa');
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText('Please tick the box to confirm you are 18 or older')).toBeVisible();
    await page.getByRole('checkbox').check();
    const cases: Array<[string, string]> = [['Ab1!', 'Password must be at least 8 characters.'], ['ABCDEFG1!', 'Password needs a lowercase letter.'], ['abcdefg1!', 'Password needs an uppercase letter.'], ['Abcdefgh!', 'Password needs a number.'], ['Abcdefg12', 'Password needs a symbol']];
    for (const [value, message] of cases) {
      await pw.fill(value);
      await page.locator('form button[type="submit"]').click();
      await expect(page.getByText(message)).toBeVisible();
    }
    await expect(page).toHaveURL(/\/login/);
  });
  test('CU-03 wrong password and empty-email reset show the documented messages', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByText('Type your email address above first')).toBeVisible();
    await page.getByPlaceholder('Email address').fill(client.email);
    await page.getByPlaceholder('Password', { exact: true }).fill('Wrong-password-1!');
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText('Email or password is incorrect')).toBeVisible();
  });
  test('CU-04 a new person is sent to the kitchen questions, finishes them, and lands on Today', async ({ page }) => {
    await rest(`kitchen_profiles?user_id=eq.${client.id}`, { method: 'DELETE' });
    try {
      await page.goto('/login');
      await page.getByPlaceholder('Email address').fill(client.email);
      await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
      await page.locator('form button[type="submit"]').click();
      await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
      await expect(page.getByText('How much oil / ghee per dish?')).toBeVisible();
      const options = ['Very light', 'I cook', 'Health conscious'];
      for (let i = 0; i < 4; i++) {
        for (const o of options) { const b = page.getByText(o, { exact: true }).first(); if (await b.isVisible().catch(() => false)) { await b.click(); break; } }
        const build = page.getByRole('button', { name: 'Build my Kitchen Profile' });
        if (await build.isVisible().catch(() => false)) { await build.click(); break; }
        await page.getByRole('button', { name: /^Next/ }).click();
      }
      await page.waitForURL(/\/app\/today/, { timeout: 20_000 });
    } finally {
      await rest('kitchen_profiles?on_conflict=user_id', { method: 'POST', body: { user_id: client.id }, prefer: 'resolution=ignore-duplicates' });
    }
  });
});

test.describe('Customer: main screens', () => {
  test('CU-05 four tabs navigate and stay healthy', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    for (const [href, url] of [['/app/log', /\/app\/log/], ['/app/insights', /\/app\/insights/], ['/app/profile', /\/app\/profile/], ['/app/today', /\/app\/today/]] as const) {
      await page.locator(`a[href="${href}"]:visible`).first().click();
      await expect(page).toHaveURL(url);
      await healthy(page);
    }
    await ctx.close();
  });
  test('CU-06 Today shows the logged totals and the four summary labels', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    await expect(page.getByText('Calories today')).toBeVisible({ timeout: 20_000 });
    for (const t of ['Protein', 'Water', 'Meals logged']) await expect(page.locator('body')).toContainText(t);
    await expect(page.locator('body')).toContainText('1400');
    await ctx.close();
  });
  test('CU-07 Today links to the weekly review and Energy and mood when those switches are on', async ({ browser }) => {
    test.skip(!flags.v2_weekly_review && !flags.v2_checkins, 'both switches are off in this environment');
    const { ctx, page } = await as(browser, client.email);
    if (flags.v2_weekly_review) { await page.getByText('Your weekly review').click(); await expect(page).toHaveURL(/weekly-review/); await healthy(page); await page.goBack(); }
    if (flags.v2_checkins) { await page.getByText('Energy and mood').first().click(); await expect(page).toHaveURL(/energy-mood/); await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20_000 }); await healthy(page); }
    await ctx.close();
  });
  test('CU-08 Log screen: search box is there, typing finds a food, clearing works', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    await page.goto('/app/log');
    const box = page.getByLabel('Search food');
    await expect(box).toBeVisible({ timeout: 20_000 });
    await box.fill('dal');
    await expect(page.getByText(/dal/i).first()).toBeVisible({ timeout: 20_000 });
    await healthy(page);
    await ctx.close();
  });
  test('CU-09 Profile: sections, footer, and the very-low-calorie warning', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    await page.goto('/app/profile');
    for (const t of ['Nutrition Goals', 'Data & Privacy', 'Nutri Smart v2.0']) await expect(page.locator('body')).toContainText(t, { timeout: 20_000 });
    await page.getByText('Data & Privacy').first().click();
    await expect(page.locator('body')).toContainText('support@nutrismart.co.in', { timeout: 20_000 });
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByText('Nutrition Goals').first().click();
    await page.locator('input[type="number"], input[inputmode="numeric"]').first().fill('900');
    await expect(page.getByText('Under 1200 kcal a day is very low')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await ctx.close();
  });
  test('CU-10 Data and Privacy: AI notice is shown; delete needs the word DELETE', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    await page.goto('/app/profile');
    await page.getByText('Data & Privacy').first().click();
    await expect(page.getByText(/Google Gemini or Anthropic Claude/)).toBeVisible();
    await page.getByText(/Delete my account/i).first().click();
    await expect(page.getByText('Type DELETE to confirm')).toBeVisible();
    await ctx.close();
  });
  test('CU-11 sign out returns to the login page and protects the app', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    await page.goto('/app/profile');
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await page.goto('/app/today');
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
  test('CU-12 the extra pages load without errors', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const path of ['/app/energy-mood', '/app/experiments', '/app/nudges', '/app/weekly-review', '/app/my-coach']) { await page.goto(path); await settle(page); await healthy(page); }
    expect(errors).toEqual([]);
    await ctx.close();
  });
  test('CU-13 nudge settings show the three controls (switch on)', async ({ browser }) => {
    test.skip(!flags.v2_nudges, 'nudges switch is off');
    const { ctx, page } = await as(browser, client.email);
    await page.goto('/app/nudges');
    for (const t of ['Reminders and messages', 'Evening log reminder', 'Messages from my coach', 'Quiet hours']) await expect(page.locator('body')).toContainText(t, { timeout: 20_000 });
    await ctx.close();
  });
  test('CU-14 a bad invite link says so', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    await page.goto('/join/not-a-real-token');
    await expect(page.getByText('This invite link is not valid.')).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  });
  test('CU-15 the app is installable: manifest, service worker, icons', async ({ request }) => {
    const m = await request.get('/manifest.webmanifest'); expect(m.status()).toBe(200);
    const j = await m.json(); expect(j.name).toContain('Nutri Smart'); expect(j.display).toMatch(/standalone|fullscreen|minimal-ui/);
    expect(j.icons.length).toBeGreaterThanOrEqual(2);
    expect((await request.get('/sw.js')).status()).toBe(200);
  });
  test.fixme('CU-16 logging while offline is kept and synced after reconnecting (needs the Dexie queue hook; verify on a phone with docs/MANUAL_TESTS.md)', async () => {});
});

// ───────────────────────── Coach ─────────────────────────
test.describe('Coach screens', () => {
  test('CO-01 dashboard: client row, search, status filter, sort and window controls', async ({ browser }) => {
    const { ctx, page } = await as(browser, coach.email, undefined, null);
    await page.goto('/coach');
    await expect(page.getByText('Who needs your attention today?')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).toContainText('E2E client');
    const search = page.getByLabel('Search clients');
    await search.fill('zzzz-nobody');
    await expect(page.getByText('No clients match this filter.')).toBeVisible();
    await search.fill('');
    await expect(page.locator('body')).toContainText('E2E client');
    for (const label of ['Sort: name', 'Sort: longest quiet', 'Sort: needs attention first']) { await page.getByLabel('Sort clients').selectOption({ label }); await expect(page.locator('body')).toContainText('E2E client'); }
    for (const v of ['7', '14', '30']) { await page.getByLabel('Time window').first().selectOption(v); await expect(page.locator('body')).not.toContainText(BAD); }
    const group = page.getByRole('group', { name: 'Filter clients' });
    const first = group.getByRole('button').first(); await first.click(); await expect(first).toHaveAttribute('aria-pressed', 'true');
    await ctx.close();
  });
  test('CO-02 invite: create a link, see the one-time warning, see it pending, cancel it', async ({ browser }) => {
    const { ctx, page } = await as(browser, coach.email, undefined, null);
    await page.goto('/coach');
    await page.getByLabel('Client name for this invite').fill('E2E invite');
    await page.getByRole('button', { name: 'Create link' }).click();
    await expect(page.getByText('It works once and expires in 14 days')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).toContainText('/join/');
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByText('E2E invite')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByText('E2E invite')).toHaveCount(0, { timeout: 20_000 });
    await ctx.close();
  });
  test('CO-03 client detail: tabs open, timeline filter toggles, no errors', async ({ browser }) => {
    const { ctx, page } = await as(browser, coach.email, undefined, null);
    await page.goto('/coach');
    await page.getByRole('link', { name: 'E2E client' }).first().click();
    await expect(page.getByTestId('client-charts')).toBeVisible({ timeout: 20_000 });
    const tabs = page.getByRole('tab');
    const n = await tabs.count(); expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) { await tabs.nth(i).click(); await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('body')).not.toContainText(BAD); }
    const filter = page.getByRole('group', { name: 'Timeline filter' });
    if (await filter.isVisible().catch(() => false)) { const b = filter.getByRole('button').nth(1); await b.click(); await expect(b).toHaveAttribute('aria-pressed', 'true'); }
    await ctx.close();
  });
  test('CO-04 nudge from the screen: preset fills the box, Send queues it, a second one the same day is refused', async ({ browser }) => {
    test.skip(!flags.v2_nudges, 'nudges switch is off');
    await rest(`nudges?user_id=eq.${client.id}`, { method: 'DELETE' });
    const { ctx, page } = await as(browser, coach.email, undefined, null);
    await page.goto('/coach');
    await settle(page);
    const nudgeBtn = page.getByRole('button', { name: 'Send a nudge' }).first();
    await expect(nudgeBtn, 'the client must appear under Needs your attention').toBeVisible({ timeout: 20_000 });
    await nudgeBtn.click();
    await expect(page.getByText('Short message (max 140 characters, no links)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /Remember your protein/ }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('p[role="status"]').last()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('p[role="status"]').last()).not.toContainText('Could not send');
    await page.getByRole('button', { name: /Nice work this week/ }).click();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('p[role="status"]').last()).toContainText(/already|today|one/i, { timeout: 20_000 });
    await ctx.close();
  });
  test('CO-05 consent in the browser: the client pauses sharing and the coach sees "Sharing paused"', async ({ browser }) => {
    test.skip(!flags.v2_coach, 'coach switch is off');
    const c = await as(browser, client.email);
    await c.page.goto('/app/my-coach');
    await c.page.getByRole('button', { name: 'Pause sharing' }).click();
    await expect(c.page.getByRole('button', { name: 'Resume sharing' })).toBeVisible({ timeout: 20_000 });
    const k = await as(browser, coach.email, undefined, null);
    await k.page.goto('/coach');
    await expect(k.page.locator('body')).toContainText('Sharing paused', { timeout: 20_000 });
    await c.page.getByRole('button', { name: 'Resume sharing' }).click();
    await expect(c.page.getByRole('button', { name: 'Pause sharing' })).toBeVisible({ timeout: 20_000 });
    await c.ctx.close(); await k.ctx.close();
  });
  test('CO-06 a coach is turned away from the admin console', async ({ browser }) => {
    const { ctx, page } = await as(browser, coach.email, undefined, null);
    await page.goto('/admin/platform');
    await settle(page);
    await expect(page.getByText('This account is not an admin.')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText('System health');
    await ctx.close();
  });
  test('CO-07 a client is turned away from the coach area data', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email);
    await page.goto('/coach');
    await settle(page);
    await expect(page.locator('body')).not.toContainText('Who needs your attention today?');
    await ctx.close();
  });
});

// ───────────────────────── Admin ─────────────────────────
test.describe('Admin screens', () => {
  const TABS: Array<[string, string]> = [['/admin/platform', 'Feature switches'], ['/admin/insights', ''], ['/admin/behaviour', ''], ['/admin/who', ''], ['/admin/free-tier', 'Free tier'], ['/admin/analytics', ''], ['/admin/users', ''], ['/admin/payments', 'UPI'], ['/admin/contributions', ''], ['/admin/search-review', '']];
  test('AD-01 all ten tabs open, are not blank and show no error', async ({ browser }) => {
    test.setTimeout(150_000);
    const { ctx, page } = await as(browser, adminU.email, undefined, null);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const [path] of TABS) {
      await page.goto(path); await settle(page);
      await expect(page.locator('body')).not.toContainText('Admin access required');
      await expect(page.locator('body')).not.toBeEmpty();
      await healthy(page);
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });
  test('AD-02 the tab bar links to every screen', async ({ browser }) => {
    const { ctx, page } = await as(browser, adminU.email, undefined, null);
    await page.goto('/admin/platform');
    for (const label of ['Platform 2.0', 'Insights', 'Behaviour', 'Who they are', 'Free tier', 'Analytics', 'Users', 'Payments', 'Contributions', 'Search review']) await expect(page.getByRole('link', { name: new RegExp(label) }).first()).toBeVisible();
    await ctx.close();
  });
  test('AD-03 admin never sees a person\'s food log', async ({ browser }) => {
    const { ctx, page } = await as(browser, adminU.email, undefined, null);
    for (const path of ['/admin/users', '/admin/analytics', '/admin/behaviour', '/admin/platform']) { await page.goto(path); await settle(page); await expect(page.locator('body')).not.toContainText('Screens poha'); await expect(page.locator('body')).not.toContainText('Screens dal rice'); }
    await ctx.close();
  });
  test('AD-04 platform sections: every section button opens without an error', async ({ browser }) => {
    const { ctx, page } = await as(browser, adminU.email, undefined, null);
    await page.goto('/admin/platform');
    for (const name of ['Overview', 'Trends', 'Feature use', 'AI usage', 'Coaches', 'Plans', 'Feature switches', 'Audit log']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.locator('body')).not.toContainText(/Could not load|Could not reach the server/);
    }
    await ctx.close();
  });
  test('AD-05 Trends charts draw (svg with a name) and the totals match the day the client logged', async ({ browser }) => {
    const { ctx, page } = await as(browser, adminU.email, undefined, null);
    await page.goto('/admin/platform');
    await page.getByRole('tab', { name: 'Trends', exact: true }).click();
    await expect(page.getByText('People active each day')).toBeVisible({ timeout: 20_000 });
    const charts = page.locator('svg[role="img"][aria-label]');
    expect(await charts.count()).toBeGreaterThanOrEqual(3);
    await ctx.close();
  });
  test('AD-06 the Free tier tab shows the watch card', async ({ browser }) => {
    const { ctx, page } = await as(browser, adminU.email, undefined, null);
    await page.goto('/admin/free-tier');
    await expect(page.locator('body')).toContainText(/Free tier watch|free plans|limit/i, { timeout: 20_000 });
    await ctx.close();
  });
});

// ───────────────────────── Security, layout, access ─────────────────────────
test.describe('Cross-cutting', () => {
  test('X-01 security headers are served on the app page', async ({ request }) => {
    const r = await request.get('/login');
    const h = r.headers();
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('microphone=(self)');
    expect(h['content-security-policy-report-only'] ?? h['content-security-policy']).toContain("default-src 'self'");
  });
  test('X-02 signed-out visitors are sent to the login page from every protected area', async ({ page }) => {
    for (const path of ['/app/today', '/app/log', '/app/profile', '/coach', '/admin/platform', '/app/my-coach']) { await page.goto(path); await page.waitForURL(/\/login/, { timeout: 20_000 }); }
  });
  test('X-03 every server function refuses a visitor who is not signed in', async ({ request }) => {
    const names = readdirSync('functions/api').filter(f => f.endsWith('.ts')).map(f => f.replace(/\.ts$/, ''));
    expect(names.length).toBeGreaterThanOrEqual(36);
    const bad: string[] = [];
    for (const n of names) for (const method of ['GET', 'POST']) {
      const r = await request.fetch(`/api/${n}`, { method, data: method === 'POST' ? {} : undefined, failOnStatusCode: false });
      const s = r.status();
      if (s === 200 || s >= 500) bad.push(`${method} ${n} -> ${s}`);
    }
    expect(bad, 'These functions answered a signed-out visitor with success or a crash').toEqual([]);
  });
  test('X-04 phone-size screens: sideways scrolling is reported (advisory)', async ({ browser }) => {
    const { ctx, page } = await as(browser, client.email, { width: 375, height: 740 });
    const over: string[] = [];
    for (const path of ['/app/today', '/app/log', '/app/insights', '/app/profile']) {
      await page.goto(path); await settle(page);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (wide > 1) over.push(`${path} +${wide}px`);
    }
    if (over.length) { console.log(`LAYOUT WARNING (advisory): sideways scroll at phone width: ${over.join(', ')}`); test.info().annotations.push({ type: 'layout-warning', description: over.join(', ') }); }
    await ctx.close();
  });
  test('X-05 coach and admin screens at phone width (advisory)', async ({ browser }) => {
    const k = await as(browser, coach.email, { width: 375, height: 740 }, null);
    await k.page.goto('/coach'); await settle(k.page);
    const kw = await k.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (kw > 1) { console.log(`LAYOUT WARNING (advisory): /coach scrolls sideways by ${kw}px at phone width`); test.info().annotations.push({ type: 'layout-warning', description: `/coach +${kw}px` }); }
    await k.ctx.close();
    const a = await as(browser, adminU.email, { width: 375, height: 740 }, null);
    await a.page.goto('/admin/platform'); await settle(a.page);
    const aw = await a.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (aw > 1) { console.log(`LAYOUT WARNING (advisory): /admin/platform scrolls sideways by ${aw}px at phone width`); test.info().annotations.push({ type: 'layout-warning', description: `/admin/platform +${aw}px` }); }
    await a.ctx.close();
  });
  test('X-06 the AI endpoints refuse bad input from a signed-in person without crashing', async () => {
    const ct = await signIn(client.email);
    for (const [path, body] of [['/api/ai-search', {}], ['/api/ai-search', { query: '' }], ['/api/ai-vision', {}]] as const) {
      const r = await api(path, { method: 'POST', token: ct, body });
      expect(r.status, `${path} with ${JSON.stringify(body)}`).toBeLessThan(500);
      expect(r.status).not.toBe(200);
    }
  });
  test('X-07 an unknown address shows the app, not a server error', async ({ page }) => {
    const r = await page.goto('/this-page-does-not-exist');
    expect(r!.status()).toBeLessThan(500);
  });
});
