// 2.1 intelligence suite (picked up by `npx playwright test e2e/v2` because the path starts with e2e/v2).
//   I-01 refresh builds features and a personal recommendation     I-02 Today shows the five parts and records the response
//   I-03 What NutriSmart learned page and reports                  I-04 coach brief, AI draft, approval, delivery
//   I-05 who can and cannot see what                               I-06 smart tips settings
//   I-07 check-in fullness and digestion                           I-08 switches off = nothing shows
//   I-09 export holds the new data (no unsent drafts)              I-10 the notification job refuses strangers
// It makes its own accounts (e2e-intel, e2e-intelcoach), switches the 2.1 switches on for the run and puts them back afterwards.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { configured, BASE, api, rest, ensureUser, signIn, istToday, PASSWORD } from '../v2/env';

test.skip(!configured, 'Set BASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY (see docs/SIMULATION.md)');

const SWITCHES = ['analytics_engine', 'personal_model', 'recommendations', 'daily_intelligence', 'adaptive_meal_plan', 'weekly_reports', 'monthly_reports', 'energy_intelligence', 'smart_notifications', 'messaging'];
type U = { id: string; email: string };
let person: U, coach: U, stranger: U;
let before: Record<string, boolean> = {};
let ready = true;
let pt = '', ct = '', st = '';

async function setFlags(on: boolean, keys = SWITCHES) { for (const k of keys) await rest(`feature_flags?key=eq.${k}`, { method: 'PATCH', body: { enabled: on } }); }
const openCtx: Array<{ close: () => Promise<void> }> = [];
async function as(browser: Browser, email: string, landing = '/app/today'): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE }); openCtx.push(ctx);
  await ctx.addInitScript(() => { try { localStorage.setItem('ns-today-expanded', '1'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  await page.goto(landing);
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  return page;
}
test.afterEach(async () => { for (const c of openCtx) await c.close().catch(() => undefined); openCtx.length = 0; });

test.beforeAll(async () => {
  person = await ensureUser('intel'); coach = await ensureUser('intelcoach'); stranger = await ensureUser('intelstranger');
  const f = await rest(`feature_flags?select=key,enabled&key=in.(${SWITCHES.join(',')})`);
  const rows = (f.data ?? []) as Array<{ key: string; enabled: boolean }>;
  if (rows.length !== SWITCHES.length) { ready = false; return; }       // migrations 041 to 043 are not applied yet
  before = Object.fromEntries(rows.map(r => [r.key, r.enabled]));
  await setFlags(true);
  for (const u of [person, coach, stranger]) await rest('kitchen_profiles?on_conflict=user_id', { method: 'POST', body: { user_id: u.id }, prefer: 'resolution=ignore-duplicates' });
  await rest(`users?id=eq.${person.id}`, { method: 'PATCH', body: { target_cal: 2000, target_protein: 100 } });
  await rest('coach_profiles', { method: 'POST', body: { user_id: coach.id, display_name: 'Intel coach', credentials: 'test', status: 'active', approved_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
  await rest(`coach_client_relationships?coach_id=eq.${coach.id}`, { method: 'DELETE' });
  await rest('coach_client_relationships', { method: 'POST', body: { coach_id: coach.id, client_id: person.id, status: 'active', share_scope: { food: true, energy: true, water: true, weight: true, mood: true }, invited_at: new Date().toISOString(), accepted_at: new Date().toISOString() } });
  for (const t of ['daily_logs', 'daily_checkins', 'flexible_meals', 'nudges', 'recommendations', 'personal_features', 'intel_reports', 'notification_decisions', 'intel_messages']) await rest(`${t}?user_id=eq.${person.id}`, { method: 'DELETE' });
  await rest(`nudge_preferences?user_id=eq.${person.id}`, { method: 'DELETE' });
  // 14 days: light-protein lunches, dal dinners, a curd and paneer snack on alternate days. Today's protein is about 43g of a 100g goal.
  const logs: any[] = [];
  for (let i = 0; i < 14; i++) {
    const d = istToday(-i);
    const row = (meal: string, name: string, cal: number, p: number) => ({ user_id: person.id, log_date: d, meal, food_name: name, portion: '1 plate', qty: 1, is_home: true, multiplier: 1, cal, protein: p, carbs: 40, fat: 8, gl: 10, anomaly: false, food_source: 'master' });
    logs.push(row('lunch', 'Intel roti sabzi', 420, 6), row('dinner', 'Intel dal rice', 500, 14));
    if (i % 2 === 0) logs.push(row('snack', 'Intel curd', 100, 9), row('snack', 'Intel paneer', 200, 14));
  }
  await rest('daily_logs', { method: 'POST', body: logs });
  pt = await signIn(person.email); ct = await signIn(coach.email); st = await signIn(stranger.email);
});
test.afterAll(async () => { if (ready) for (const [k, v] of Object.entries(before)) await rest(`feature_flags?key=eq.${k}`, { method: 'PATCH', body: { enabled: v } }); });
test.beforeEach(async () => { test.skip(!ready, 'Run supabase/migrations 041, 042 and 043 first (the 2.1 tables and switches are missing).'); });

test.describe('2.1 intelligence', () => {
  test('I-01 refresh builds the feature store and a personal recommendation from foods the person logs', async () => {
    const r = await api('/api/intel-refresh', { method: 'POST', token: pt, body: {} });
    expect(r.status, JSON.stringify(r.j)).toBe(200);
    expect(r.j.signal.headline.length).toBeGreaterThan(3);
    const rec = (r.j.recommendations as any[]).find(x => x.rec_key === 'protein_lunch');
    expect(rec, JSON.stringify(r.j.recommendations)).toBeTruthy();
    for (const k of ['reason', 'evidence', 'confidence', 'action', 'expected_outcome', 'follow_up_at']) expect(rec[k], k).toBeTruthy();
    expect(rec.action).toMatch(/paneer|curd/i);
    const f = await rest(`personal_features?user_id=eq.${person.id}&feature_key=eq.lunch_protein_avg&select=window_days,value,sample_size,confidence,trend,calculated_at`);
    const by = Object.fromEntries((f.data as any[]).map(x => [x.window_days, x]));
    expect(Object.keys(by).sort()).toEqual(['1', '14', '30', '7', '90']);
    expect(Number(by[7].value)).toBe(6); expect(by[7].sample_size).toBe(7); expect(by[7].calculated_at).toBeTruthy();
  });

  test('I-02 Today shows the five parts, and the response is recorded', async ({ browser }) => {
    const page = await as(browser, person.email);
    for (const h of ["Today's signal", 'Your progress', 'What to do next', 'Smart meal']) await expect(page.getByRole('heading', { name: h })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/light on protein/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'I will try this' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'We will check how it went' })).toBeVisible();
    const r = await rest(`recommendations?user_id=eq.${person.id}&rec_key=eq.protein_lunch&select=status,acted_at`);
    expect(r.data[0].status).toBe('accepted'); expect(r.data[0].acted_at).toBeTruthy();
  });

  test('I-03 What NutriSmart learned, weekly and monthly reports are built from the numbers', async ({ browser }) => {
    const page = await as(browser, person.email, '/app/learned');
    await expect(page.getByText(/Your lunches average 6g protein/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: 'Your week' }).click();
    await expect(page.getByRole('heading', { name: 'Adherence' })).toBeVisible();
    await page.getByRole('tab', { name: 'Your month' }).click();
    await expect(page.getByRole('heading', { name: 'Next priorities' })).toBeVisible();
    for (const period of ['daily', 'weekly', 'monthly', 'learning']) {
      const r = await api('/api/intel-report', { method: 'POST', token: pt, body: { period } });
      expect(r.status, period).toBe(200); expect(r.j.report.sections.length, period).toBeGreaterThan(0);
    }
    const saved = await rest(`intel_reports?user_id=eq.${person.id}&select=period`);
    expect(new Set((saved.data as any[]).map(x => x.period))).toEqual(new Set(['daily', 'weekly', 'monthly', 'learning']));
  });

  test('I-04 coach brief, AI draft, review, approval and delivery', async ({ browser }) => {
    await rest(`intel_messages?user_id=eq.${person.id}`, { method: 'DELETE' }); await rest(`nudges?user_id=eq.${person.id}`, { method: 'DELETE' });
    await setFlags(true, ['v2_nudges']).catch(() => undefined);
    const page = await as(browser, coach.email, `/coach/client/${person.id}`);
    await expect(page.getByLabel('Coach brief')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Coach brief')).toContainText('Protein is well under the goal.');
    await page.getByRole('button', { name: 'Draft a message for review' }).click();
    const box = page.getByLabel(/Draft \(edit before sending/);
    await expect(box).toBeVisible();
    // Nothing reaches the client until the coach approves.
    expect(((await rest(`intel_messages?select=id`, { token: pt })).data as any[]).length).toBe(0);
    await box.fill('Hi, could we add paneer or curd to your lunch this week?');
    await page.getByRole('button', { name: 'Approve and send' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Sent|Saved/ })).toBeVisible({ timeout: 15_000 });
    const seen = await rest(`intel_messages?select=sender_type,status,body,reason`, { token: pt });
    expect((seen.data as any[]).length).toBe(1); expect(seen.data[0]).toEqual({ sender_type: 'coach', status: 'sent', body: 'Hi, could we add paneer or curd to your lunch this week?', reason: seen.data[0].reason });
    const n = await rest(`nudges?user_id=eq.${person.id}&kind=eq.coach_message&select=body`);
    expect(n.data[0].body).toBe('Hi, could we add paneer or curd to your lunch this week?');
    const respond = await api('/api/messages', { method: 'POST', token: pt, body: { action: 'respond', message_id: seen.data[0].id ?? (await rest(`intel_messages?user_id=eq.${person.id}&select=id`)).data[0].id, response: 'done' } });
    expect(respond.status).toBe(200);
    const bad = await api('/api/messages', { method: 'POST', token: ct, body: { action: 'review', message_id: (await rest(`intel_messages?user_id=eq.${person.id}&select=id`)).data[0].id, decision: 'approve' } });
    expect(bad.status, 'a message that was already sent cannot be approved again').toBe(404);
  });

  test('I-05 who can and cannot see what', async () => {
    const own = await rest(`personal_features?select=user_id`, { token: pt });
    expect((own.data as any[]).length).toBeGreaterThan(0);
    expect(((await rest(`personal_features?select=user_id`, { token: st })).data as any[]).length, 'stranger sees no features').toBe(0);
    expect(((await rest(`recommendations?select=id`, { token: ct })).data as any[]).length, 'coach reads recommendations only through the brief').toBe(0);
    expect((await rest('personal_features', { method: 'POST', token: pt, body: { user_id: person.id, feature_key: 'x', window_days: 7 } })).status, 'browser cannot write features').toBeGreaterThanOrEqual(400);
    expect((await api('/api/coach-intel', { method: 'POST', token: st, body: { client_id: person.id } })).status, 'a client is not a coach').toBe(403);
    expect((await api('/api/messages', { method: 'POST', token: pt, body: { action: 'draft', client_id: person.id } })).status).toBe(403);
    const otherCoach = await ensureUser('intelcoach2'); await rest('coach_profiles', { method: 'POST', body: { user_id: otherCoach.id, display_name: 'Other', credentials: 'x', status: 'active', approved_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
    const oct = await signIn(otherCoach.email);
    expect((await api('/api/coach-intel', { method: 'POST', token: oct, body: { client_id: person.id } })).status, 'an unlinked coach sees nothing').toBe(404);
    expect((await api('/api/messages', { method: 'POST', token: oct, body: { action: 'draft', client_id: person.id } })).status).toBe(404);
    const rid = (await rest(`recommendations?user_id=eq.${person.id}&select=id`)).data[0].id;
    expect((await api('/api/rec-action', { method: 'POST', token: st, body: { rec_id: rid, action: 'dismissed' } })).status, 'cannot change someone else\'s recommendation').toBe(404);
    for (const p of ['/api/intel-refresh', '/api/intel-report', '/api/rec-action', '/api/coach-intel', '/api/messages']) expect((await api(p, { method: 'POST', body: {} })).status, p).toBe(401);
  });

  test('I-06 smart tips settings: opt in, choose kinds', async ({ browser }) => {
    const page = await as(browser, person.email, '/app/nudges');
    const toggle = page.getByRole('checkbox', { name: 'Smart tips' });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole('checkbox', { name: 'Protein tips' }).uncheck();
    await expect.poll(async () => (await rest(`nudge_preferences?user_id=eq.${person.id}&select=smart_nudges,smart_kinds_off`)).data?.[0], { timeout: 10_000 }).toEqual({ smart_nudges: true, smart_kinds_off: ['protein_reminder'] });
  });

  test('I-07 check-in takes optional fullness and digestion', async ({ browser }) => {
    test.skip(!(await rest('feature_flags?key=eq.v2_checkins&select=enabled')).data?.[0]?.enabled, 'v2_checkins switch is off');
    await rest(`daily_checkins?user_id=eq.${person.id}`, { method: 'DELETE' });
    const page = await as(browser, person.email);
    const card = page.getByLabel('Morning check-in');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByText(/More \(optional\)/).click();
    await card.getByRole('button', { name: 'Fullness after meals 4 of 5' }).click();
    await card.getByRole('button', { name: 'heavy', exact: true }).click();
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Check-in saved')).toBeVisible({ timeout: 10_000 });
    const r = await rest(`daily_checkins?user_id=eq.${person.id}&select=fullness,digestion`);
    expect(r.data[0]).toEqual({ fullness: 4, digestion: 'heavy' });
  });

  test('I-08 with the switches off nothing new shows and the server says so', async ({ browser }) => {
    await setFlags(false, ['daily_intelligence', 'analytics_engine']);
    try {
      expect((await api('/api/intel-refresh', { method: 'POST', token: pt, body: {} })).status).toBe(403);
      const page = await as(browser, person.email);
      await expect(page.locator('body')).not.toContainText("Today's signal");
      await expect(page.locator('body')).toContainText('Protein');          // the normal Today screen is untouched
    } finally { await setFlags(true, ['daily_intelligence', 'analytics_engine']); }
  });

  test('I-09 the export holds the new data and no unsent drafts', async () => {
    await rest('intel_messages', { method: 'POST', body: { user_id: person.id, sender_type: 'ai_draft', sender_id: coach.id, reason: 'x', body: 'unsent draft', status: 'draft' } });
    const res = await fetch(`${BASE}/api/export-my-data`, { method: 'POST', headers: { Authorization: `Bearer ${pt}` } });
    const j: any = await res.json();
    for (const t of ['personal_features', 'recommendations', 'intel_reports', 'notification_decisions', 'intel_messages']) expect(Array.isArray(j[t]), t).toBe(true);
    expect(JSON.stringify(j.intel_messages)).not.toContain('unsent draft');
    await rest(`intel_messages?user_id=eq.${person.id}&status=eq.draft`, { method: 'DELETE' });
  });

  test('I-10 the notification job refuses anyone without the secret', async () => {
    const r = await fetch(`${BASE}/api/cron-intel`, { method: 'POST' });
    expect(r.status).toBe(403);
    const w = await fetch(`${BASE}/api/cron-intel`, { method: 'POST', headers: { 'x-cron-secret': 'wrong' } });
    expect(w.status).toBe(403);
  });
});
