// 2.0 end-to-end suite: three made-up accounts (client, coach, admin) exercise every module through the real deployed app and database.
// Runs in GitHub Actions against the v2 preview. Skips itself when the secrets are not set.
import { test, expect } from '@playwright/test';
import { configured, api, rest, ensureUser, signIn, istToday, PASSWORD } from './env';

test.skip(!configured, 'Set BASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY (see docs/SIMULATION.md)');

let client: { id: string; email: string }, coach: { id: string; email: string }, adminU: { id: string; email: string };
let ct = '', kt = '', at = ''; // client, coach, admin tokens
let flags: Record<string, boolean> = {};
const today = istToday();

test.beforeAll(async () => {
  client = await ensureUser('client'); coach = await ensureUser('coach'); adminU = await ensureUser('admin');
  // Clean start: remove anything the previous run left for the test client, then link and promote.
  for (const t of ['daily_logs', 'daily_checkins', 'flexible_meals', 'nudges']) await rest(`${t}?user_id=eq.${client.id}`, { method: 'DELETE' });
  await rest(`coach_client_relationships?coach_id=eq.${coach.id}`, { method: 'DELETE' });
  // Without a kitchen profile the app sends a new person to the onboarding questions, so give each test account one.
  for (const u of [client, coach, adminU]) await rest('kitchen_profiles?on_conflict=user_id', { method: 'POST', body: { user_id: u.id }, prefer: 'resolution=ignore-duplicates' });
  await rest('admin_users', { method: 'POST', body: { user_id: adminU.id }, prefer: 'resolution=ignore-duplicates' });
  await rest('coach_profiles', { method: 'POST', body: { user_id: coach.id, display_name: 'E2E coach', credentials: 'test', status: 'active', approved_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
  await rest('coach_client_relationships', { method: 'POST', body: { coach_id: coach.id, client_id: client.id, status: 'active', share_scope: { food: true, energy: true, water: true, weight: true, mood: true }, invited_at: new Date().toISOString(), accepted_at: new Date().toISOString() } });
  ct = await signIn(client.email); kt = await signIn(coach.email); at = await signIn(adminU.email);
  const f = await rest('feature_flags?select=key,enabled');
  flags = Object.fromEntries((f.data as any[]).map(r => [r.key, r.enabled]));
});

test.describe('Client: logging and daily modules', () => {
  test.describe.configure({ mode: 'serial' });
  test('log three meals; stored daily totals match the arithmetic', async () => {
    const rows = [['breakfast', 'Test poha', 300, 8, 50, 8], ['lunch', 'Test dal rice', 600, 22, 90, 14], ['dinner', 'Test roti sabzi', 500, 16, 70, 12]].map(([meal, name, cal, p, c, f]) => ({
      user_id: client.id, log_date: today, meal, food_name: name, portion: '1 plate', qty: 1, is_home: true, multiplier: 1, cal, protein: p, carbs: c, fat: f, gl: 10, anomaly: false, food_source: 'master',
    }));
    const ins = await rest('daily_logs', { method: 'POST', body: rows, token: ct });
    expect(ins.status).toBeLessThan(300);
    const m = await rest(`daily_nutrition_metrics?user_id=eq.${client.id}&day=eq.${today}`, { token: ct });
    expect(Number(m.data[0].calories)).toBe(1400); expect(Number(m.data[0].protein_g)).toBe(46); expect(m.data[0].items).toBe(3);
    const a = await rest(`daily_adherence?user_id=eq.${client.id}&day=eq.${today}`, { token: ct });
    expect(Number(a.data[0].logging_adherence)).toBe(100);
  });
  test('daily check-in saves and reads back', async () => {
    const r = await rest('daily_checkins?on_conflict=user_id,log_date', { method: 'POST', token: ct, prefer: 'resolution=merge-duplicates', body: { user_id: client.id, log_date: today, energy: 4, mood: 4, hunger: 3, sleep: 'good', stress: 'low' } });
    expect(r.status).toBeLessThan(300);
    const g = await rest(`daily_checkins?user_id=eq.${client.id}&log_date=eq.${today}`, { token: ct });
    expect(g.data[0].energy).toBe(4);
  });
  test('flexible meal can be planned and marked eaten', async () => {
    const p = await rest('flexible_meals', { method: 'POST', token: ct, prefer: 'return=representation', body: { user_id: client.id, planned_for: today, planned_time: '20:00', label: 'E2E dinner out', reserved_kcal: 900 } });
    expect(p.status).toBeLessThan(300);
    const u = await rest(`flexible_meals?id=eq.${p.data[0].id}`, { method: 'PATCH', token: ct, prefer: 'return=representation', body: { status: 'consumed', consumed_kcal: 850 } });
    expect(u.data[0].status).toBe('consumed');
  });
  test('a person cannot read or write another person\'s data', async () => {
    const other = await rest(`daily_logs?user_id=neq.${client.id}&select=id&limit=5`, { token: ct });
    expect(other.data).toEqual([]);
    const bad = await rest('daily_logs', { method: 'POST', token: ct, body: { user_id: coach.id, log_date: today, meal: 'lunch', food_name: 'x', portion: '1', qty: 1, cal: 1, protein: 1, carbs: 1, fat: 1 } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
  test('plans, export and weekly review respond correctly', async () => {
    const p = await api('/api/plans', { token: ct }); expect(p.status).toBe(200); expect(Array.isArray(p.j.plans)).toBe(true);
    const e = await api('/api/export-my-data', { method: 'POST', token: ct }); expect(e.status).toBe(200);
    const w = await api('/api/weekly-review', { method: 'POST', token: ct, body: { week: 'current' } });
    expect(w.status).toBe(flags.v2_weekly_review ? 200 : 403);
  });
  test('a client cannot use coach or admin endpoints', async () => {
    for (const path of ['/api/attention-action', '/api/nudge-send']) expect((await api(path, { method: 'POST', token: ct, body: {} })).status).toBe(403);
    for (const path of ['/api/admin-platform', '/api/admin-flags', '/api/admin-audit', '/api/admin-plans', '/api/admin-v2-analytics', '/api/admin-coaches']) expect((await api(path, { token: ct })).status).toBe(403);
  });
  test('visitors without a login are refused everywhere', async () => {
    for (const path of ['/api/admin-platform', '/api/plans', '/api/weekly-review']) expect([401, 405]).toContain((await api(path, { method: path === '/api/weekly-review' ? 'POST' : 'GET' })).status);
  });
});

test.describe('Coach: dashboard, privacy and actions', () => {
  test.describe.configure({ mode: 'serial' });
  test('dashboard shows the client with the numbers the client logged', async () => {
    const r = await rest('rpc/coach_dashboard', { method: 'POST', token: kt, body: { p_days: 7 } });
    const row = (r.data as any[]).find(x => x.client_id === client.id);
    expect(row).toBeTruthy(); expect(row.days_logged).toBe(1); expect(Number(row.avg_cal)).toBe(1400); expect(Number(row.avg_protein)).toBe(46);
  });
  test('coach sees only linked clients', async () => {
    const mine = await rest('daily_logs?select=user_id', { token: kt });
    expect(new Set((mine.data as any[]).map(x => x.user_id))).toEqual(new Set([client.id]));
  });
  test('privacy: when the client stops sharing food, the coach sees nothing', async () => {
    await rest(`coach_client_relationships?coach_id=eq.${coach.id}`, { method: 'PATCH', body: { share_scope: { food: false, energy: false, water: false, weight: false, mood: false } } });
    expect(((await rest('daily_logs?select=id', { token: kt })).data as any[]).length).toBe(0);
    expect(((await rest('daily_checkins?select=id', { token: kt })).data as any[]).length).toBe(0);
    await rest(`coach_client_relationships?coach_id=eq.${coach.id}`, { method: 'PATCH', body: { share_scope: { food: true, energy: true, water: true, weight: true, mood: true } } });
    expect(((await rest('daily_logs?select=id', { token: kt })).data as any[]).length).toBeGreaterThan(0);
  });
  test('chart numbers: 14 days for the client, today matches what was logged', async () => {
    const r = await rest('rpc/coach_client_series', { method: 'POST', token: kt, body: { p_days: 14, p_client: client.id } });
    expect((r.data as any[]).length).toBe(14);
    const t = (r.data as any[]).find(x => x.day === today); expect(Number(t.calories)).toBe(1400); expect(t.items).toBe(3);
    expect(Number((r.data as any[]).find(x => x.day === istToday(-1)).calories)).toBe(0);
  });
  test('snooze and clear an attention signal', async () => {
    const s = await api('/api/attention-action', { method: 'POST', token: kt, body: { client_id: client.id, signal: 'logging_decline', action: 'snooze', severity: 'attention', days: 3 } });
    expect(s.status).toBe(200);
    const c = await api('/api/attention-action', { method: 'POST', token: kt, body: { client_id: client.id, signal: 'logging_decline', action: 'clear' } });
    expect(c.status).toBe(200);
  });
  test('nudges: allowed text queues, links are refused, strangers are refused', async () => {
    const ok = await api('/api/nudge-send', { method: 'POST', token: kt, body: { client_id: client.id, text: 'Nice work today. Keep going!' } });
    expect(ok.status).toBe(flags.v2_nudges ? 200 : 403);
    if (flags.v2_nudges) {
      expect((await api('/api/nudge-send', { method: 'POST', token: kt, body: { client_id: client.id, text: 'visit www.example.com' } })).status).toBe(400);
      expect((await api('/api/nudge-send', { method: 'POST', token: kt, body: { client_id: coach.id, text: 'hello' } })).status).toBe(404);
      const again = await api('/api/nudge-send', { method: 'POST', token: kt, body: { client_id: client.id, text: 'A second message the same day' } });
      expect(again.status).toBe(429); expect(again.j.error).toBe('already_sent_today'); // the one-nudge-a-day rule
    }
  });
  test('coach can open the client\'s weekly review, a stranger cannot', async () => {
    const r = await api('/api/weekly-review', { method: 'POST', token: kt, body: { client_id: client.id, week: 'current' } });
    expect(r.status).toBe(flags.v2_weekly_review ? 200 : 403);
    if (flags.v2_weekly_review) expect((await api('/api/weekly-review', { method: 'POST', token: kt, body: { client_id: adminU.id, week: 'current' } })).status).toBeGreaterThanOrEqual(403);
  });
});

test.describe('Admin: every section and the switches', () => {
  test.describe.configure({ mode: 'serial' });
  test('metrics, analytics, plans, coaches and audit load with sensible numbers', async () => {
    const p = await api('/api/admin-platform', { token: at }); expect(p.status).toBe(200); expect(p.j.metrics.users.total).toBeGreaterThanOrEqual(3);
    expect((await api('/api/admin-v2-analytics', { token: at })).status).toBe(200);
    const pl = await api('/api/admin-plans', { token: at }); expect(pl.status).toBe(200); expect(pl.j.plans.length).toBeGreaterThan(0);
    const co = await api('/api/admin-coaches', { token: at }); expect(co.status).toBe(200); expect(co.j.coaches.some((c: any) => c.user_id === coach.id)).toBe(true);
    expect((await api('/api/admin-audit', { token: at })).status).toBe(200);
  });
  test('chart numbers for the admin Trends screen are complete', async () => {
    const r = await api('/api/admin-series?days=30', { token: at });
    expect(r.status).toBe(200); expect(r.j.series.series.length).toBe(30); expect(r.j.series.depth_7d.length).toBe(8);
    const today = r.j.series.series[29];
    expect(today.food_logs).toBeGreaterThanOrEqual(3); expect(today.active_people).toBeGreaterThanOrEqual(1);
    expect((await api('/api/admin-series', { token: ct })).status).toBe(403);
  });
  test('feature switch flips, is audited, and is restored', async () => {
    const key = 'v2_voice'; const before = flags[key] ?? false;
    expect((await api('/api/admin-flags', { method: 'POST', token: at, body: { key, enabled: !before } })).status).toBe(200);
    const g = await api('/api/admin-flags', { token: at }); expect(g.j.flags.find((f: any) => f.key === key).enabled).toBe(!before);
    expect((await api('/api/admin-flags', { method: 'POST', token: at, body: { key, enabled: before } })).status).toBe(200);
    const audit = await api('/api/admin-audit', { token: at }); expect(JSON.stringify(audit.j.entries)).toContain('flag_set');
    expect((await api('/api/admin-flags', { method: 'POST', token: at, body: { key: 'no_such_flag', enabled: true } })).status).toBe(404);
  });
  test('a coach cannot use admin endpoints', async () => {
    expect((await api('/api/admin-flags', { token: kt })).status).toBe(403);
  });
});

test.describe('Screens in a real browser', () => {
  const login = async (page: any, email: string) => {
    await page.goto('/login');
    await page.getByPlaceholder('Email address').fill(email);
    await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/\/app\//, { timeout: 20_000 });
  };
  test('client sees Today and the logged calories', async ({ page }) => {
    await login(page, client.email);
    await page.goto('/app/today'); // sign-in lands on the Log tab
    await expect(page.getByText('Calories today')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).toContainText('1400');
    await page.goto('/app/insights'); await expect(page.locator('body')).not.toContainText('Something went wrong');
  });
  test('coach sees the dashboard with the client', async ({ page }) => {
    await login(page, coach.email);
    await page.goto('/coach');
    await expect(page.getByText('Who needs your attention today?')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).toContainText('E2E client');
    await expect(page.getByTestId('coach-insights')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('coach-insights').locator('svg[role="img"]').first()).toBeVisible();
    await page.getByRole('link', { name: 'E2E client' }).first().click();
    await expect(page.getByTestId('client-charts')).toBeVisible({ timeout: 20_000 });
  });
  test('admin sees every section', async ({ page }) => {
    await login(page, adminU.email);
    await page.goto('/admin/platform');
    await expect(page.getByText('USERS', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Trends', exact: true }).click();
    await expect(page.getByText('People active each day')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('svg[role="img"]').first()).toBeVisible();
    for (const name of ['Feature use', 'AI usage', 'Coaches', 'Plans', 'Feature switches', 'Audit log']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('body')).not.toContainText('Could not load');
    }
  });
  test('a non-admin is turned away from the admin screen', async ({ page }) => {
    await login(page, client.email);
    await page.goto('/admin/platform');
    await expect(page.locator('body')).not.toContainText('Feature switches');
  });
});
