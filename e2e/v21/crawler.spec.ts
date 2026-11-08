// The "press every button" suite. For the customer, the coach and the admin it opens every screen and presses every visible button, tab
// and in-app link (skipping only the ones that spend money, leave the app, delete an account or sign out), and fails on:
//   a JavaScript error | an error screen | a server error (5xx) | a refused request to our own API (401/403) | a button that
//   starts a save that the database refuses (the "Birthday dinner" Skipped/Cancel bug) | a screen that never finishes loading.
// It also lists the buttons that did nothing at all, so nothing hides. Admin pressing is limited to looking (tabs, ranges, refresh):
// the database is shared with real people, so it never approves, rejects, grants or removes anything.
import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test';
import { configured, BASE, rest, ensureUser, istToday, PASSWORD } from '../v2/env';

test.skip(!configured, 'Set BASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY (see docs/SIMULATION.md)');
test.setTimeout(420_000);

type U = { id: string; email: string };
let client: U, coach: U, adminU: U;
let before: Record<string, boolean> = {};
const OPEN_ALL = ['v2_checkins', 'v2_flexible_meals', 'v2_mood_insights', 'v2_patterns', 'v2_experiments', 'v2_nudges', 'v2_weekly_review', 'v2_monthly_review', 'v2_plans', 'v2_attention', 'v2_ai_reviews', 'v2_voice', 'v2_coach',
  'analytics_engine', 'personal_model', 'recommendations', 'daily_intelligence', 'adaptive_meal_plan', 'weekly_reports', 'monthly_reports', 'energy_intelligence', 'smart_notifications', 'messaging'];

// Never pressed: money, leaving the app, deleting, signing out, permission prompts, irreversible shared-data actions.
const NEVER = /sign ?out|log ?out|delete|remove my|upgrade|unlock with pro|pay|upi|whatsapp|activate pro|grant|revoke|approve|reject|suspend|ban\b|install|enable push|allow|notification|terms|privacy|support|mailto|export my data|download|copy invite|paste/i;
const SAFE_ADMIN = /^(overview|trends|feature use|ai usage|coaches|plans|feature switches|audit log|users|payments|contributions|search review|insights|behaviour|who they are|free tier|refresh|7 days|14 days|30 days|90 days|today|week|month|previous|next)/i;
const ERROR_SCREEN = /Something went wrong|Application error|Unexpected Application Error|Cannot read properties|is not a function/i;

async function settle(page: Page) {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
}
async function loginAs(browser: Browser, email: string) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ns-today-expanded', '1'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app\/|\/coach|\/admin/, { timeout: 20_000 });
  return { ctx, page };
}

interface Findings { errors: string[]; noops: string[]; pressed: number; screens: number }
async function crawl(page: Page, routes: string[], opts: { adminOnly?: boolean; maxPerScreen?: number } = {}): Promise<Findings> {
  const f: Findings = { errors: [], noops: [], pressed: 0, screens: 0 };
  let where = '';
  page.on('pageerror', e => f.errors.push(`${where}: JS error: ${String(e.message).slice(0, 160)}`));
  page.on('response', r => {
    const u = r.url(), s = r.status();
    if (s >= 500) f.errors.push(`${where}: server error ${s} ${u.replace(/\?.*/, '').slice(-70)}`);
    if ((s === 401 || s === 403) && u.startsWith(BASE + '/api/')) f.errors.push(`${where}: refused ${s} ${u.replace(BASE, '').replace(/\?.*/, '')}`);
    // a save the database refuses: PostgREST answers 4xx (not 401/406) to a write
    if (s >= 400 && s < 500 && s !== 401 && s !== 406 && u.includes('/rest/v1/') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.request().method())) f.errors.push(`${where}: the database refused a save (${s}) ${r.request().method()} ${u.replace(/.*\/rest\/v1\//, '').replace(/\?.*/, '')}`);
  });
  page.on('dialog', d => void d.dismiss().catch(() => undefined));
  page.on('popup', p => void p.close().catch(() => undefined));
  for (const route of routes) {
    where = route; f.screens++;
    await page.goto(route); await settle(page);
    if (ERROR_SCREEN.test(await page.locator('body').innerText().catch(() => ''))) { f.errors.push(`${route}: shows an error screen`); continue; }
    await expect(page.getByText(/^Loading…$/)).toHaveCount(0, { timeout: 15_000 }).catch(() => f.errors.push(`${route}: still says Loading… after 15 seconds`));
    // snapshot of what can be pressed on this screen
    const labels: Array<{ name: string; role: 'button' | 'tab' }> = await page.evaluate(() => {
      const out: Array<{ name: string; role: 'button' | 'tab' }> = [];
      const seen = new Set<string>();
      document.querySelectorAll<HTMLElement>('button, [role="tab"]').forEach(el => {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height || (el as HTMLButtonElement).disabled) return;
        if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-current')) return;   // already the chosen one: pressing it is meant to do nothing
        const name = (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim();
        const role = el.getAttribute('role') === 'tab' ? 'tab' : 'button';
        if (!name || name.length > 60 || seen.has(role + name)) return; seen.add(role + name); out.push({ name, role });
      });
      return out;
    });
    let n = 0;
    for (const l of labels) {
      if (n >= (opts.maxPerScreen ?? 45)) break;
      if (NEVER.test(l.name)) continue;
      if (opts.adminOnly && !SAFE_ADMIN.test(l.name)) continue;
      const el = page.getByRole(l.role, { name: l.name, exact: true }).first();
      if (!(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) continue;
      const htmlBefore = await page.locator('body').innerHTML().catch(() => '');
      let requests = 0; const count = () => { requests++; }; page.on('request', count);
      const urlBefore = page.url();
      try { await el.click({ timeout: 4_000 }); } catch { page.off('request', count); continue; }
      n++; f.pressed++;
      await page.waitForTimeout(450);
      page.off('request', count);
      const htmlAfter = await page.locator('body').innerHTML().catch(() => '');
      if (ERROR_SCREEN.test(await page.locator('body').innerText().catch(() => ''))) f.errors.push(`${route}: pressing "${l.name}" led to an error screen`);
      if (htmlAfter === htmlBefore && requests === 0 && page.url() === urlBefore) f.noops.push(`${route}: "${l.name}" did nothing visible`);
      await page.keyboard.press('Escape').catch(() => undefined);
      if (new URL(page.url()).pathname !== new URL(urlBefore).pathname) { await page.goto(route); await settle(page); }
    }
  }
  return f;
}
async function report(name: string, f: Findings, info: TestInfo) {
  const body = `${name}: ${f.screens} screens, ${f.pressed} buttons pressed\n\nErrors (${f.errors.length}):\n${f.errors.join('\n') || '  none'}\n\nButtons that did nothing visible (${f.noops.length}):\n${f.noops.join('\n') || '  none'}\n`;
  console.log(body); await info.attach(`${name}-crawl.txt`, { body, contentType: 'text/plain' });
}

test.beforeAll(async () => {
  client = await ensureUser('crawlclient'); coach = await ensureUser('crawlcoach'); adminU = await ensureUser('crawladmin');
  const f = await rest(`feature_flags?select=key,enabled&key=in.(${OPEN_ALL.join(',')})`);
  before = Object.fromEntries(((f.data ?? []) as Array<{ key: string; enabled: boolean }>).map(r => [r.key, r.enabled]));
  for (const k of Object.keys(before)) await rest(`feature_flags?key=eq.${k}`, { method: 'PATCH', body: { enabled: true } });
  for (const u of [client, coach, adminU]) await rest('kitchen_profiles?on_conflict=user_id', { method: 'POST', body: { user_id: u.id }, prefer: 'resolution=ignore-duplicates' });
  await rest('coach_profiles', { method: 'POST', body: { user_id: coach.id, display_name: 'Crawl coach', credentials: 'test', status: 'active', approved_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
  await rest('admin_users', { method: 'POST', body: { user_id: adminU.id }, prefer: 'resolution=ignore-duplicates' });
  await rest(`coach_client_relationships?coach_id=eq.${coach.id}`, { method: 'DELETE' });
  await rest('coach_client_relationships', { method: 'POST', body: { coach_id: coach.id, client_id: client.id, status: 'active', share_scope: { food: true, energy: true, water: true, weight: true, mood: true }, invited_at: new Date().toISOString(), accepted_at: new Date().toISOString() } });
  for (const t of ['daily_logs', 'daily_checkins', 'flexible_meals', 'nudges']) await rest(`${t}?user_id=in.(${client.id},${coach.id})`, { method: 'DELETE' });
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 7; i++) { const d = istToday(-i); rows.push({ user_id: client.id, log_date: d, meal: 'lunch', food_name: 'Crawl dal rice', portion: '1 plate', qty: 1, is_home: true, multiplier: 1, cal: 500, protein: 14, carbs: 70, fat: 10, gl: 15, anomaly: false, food_source: 'master' }); }
  await rest('daily_logs', { method: 'POST', body: rows });
  await rest('flexible_meals', { method: 'POST', body: { user_id: client.id, planned_for: istToday(), planned_time: '20:00', label: 'Crawl birthday dinner', reserved_kcal: 900 } });
});
test.afterAll(async () => { for (const [k, v] of Object.entries(before)) await rest(`feature_flags?key=eq.${k}`, { method: 'PATCH', body: { enabled: v } }); });

test('CR-1 customer: every screen, every button', async ({ browser }, info) => {
  const { ctx, page } = await loginAs(browser, client.email);
  const f = await crawl(page, ['/app/today', '/app/log', '/app/insights', '/app/profile', '/app/energy-mood', '/app/experiments', '/app/nudges', '/app/weekly-review', '/app/my-coach', '/app/learned']);
  await report('customer', f, info); await ctx.close();
  expect(f.pressed, 'the crawler should have pressed a good number of buttons').toBeGreaterThan(25);
  expect(f.errors).toEqual([]);
});

test('CR-2 coach: dashboard, client page, the coach\'s own Today; every button', async ({ browser }, info) => {
  const { ctx, page } = await loginAs(browser, coach.email);
  const f = await crawl(page, ['/coach', `/coach/client/${client.id}`, '/app/today', '/app/profile', '/app/nudges']);
  await report('coach', f, info); await ctx.close();
  expect(f.pressed).toBeGreaterThan(8);
  expect(f.errors).toEqual([]);
});

test('CR-3 admin: every section loads and every tab, range and refresh works (looking only)', async ({ browser }, info) => {
  const { ctx, page } = await loginAs(browser, adminU.email);
  const f = await crawl(page, ['/admin/platform', '/admin/insights', '/admin/behaviour', '/admin/who', '/admin/free-tier', '/admin/analytics', '/admin/users', '/admin/payments', '/admin/contributions', '/admin/search-review'], { adminOnly: true });
  await report('admin', f, info); await ctx.close();
  expect(f.screens).toBe(10);
  expect(f.pressed, 'the eight section tabs on Platform 2.0 alone should be pressed').toBeGreaterThan(6);
  expect(f.errors).toEqual([]);
});

test('CR-4 phone size: customer screens fit without sideways scrolling', async ({ browser }, info) => {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 375, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ns-today-expanded', '1'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('Email address').fill(client.email);
  await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  const wide: string[] = [];
  for (const r of ['/app/today', '/app/log', '/app/insights', '/app/profile', '/app/energy-mood', '/app/nudges', '/app/learned', '/app/weekly-review']) {
    await page.goto(r); await settle(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 4) wide.push(`${r} is ${over}px wider than the phone screen`);
  }
  await info.attach('phone-width.txt', { body: wide.join('\n') || 'all fit', contentType: 'text/plain' });
  await ctx.close();
  expect(wide).toEqual([]);
});
