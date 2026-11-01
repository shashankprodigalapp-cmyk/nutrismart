// Helpers for the 2.0 end-to-end suite. It makes its own test accounts (e2e-client, e2e-coach, e2e-admin @sim.nutrismart.invalid),
// so nobody has to hand over a password. It needs the Supabase service key, which lives only in GitHub secrets.
import { randomBytes } from 'node:crypto';

export const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
export const SB = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const ANON = process.env.SUPABASE_ANON_KEY ?? '';
export const configured = !!(BASE && SB && SERVICE && ANON);
export const DOMAIN = '@sim.nutrismart.invalid';
export const PASSWORD = 'E2e-' + randomBytes(9).toString('hex'); // new every run, never stored

export const istToday = (offset = 0): string => {
  const d = new Date(Date.now() + 330 * 60_000 + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};

type Json = Record<string, any>;
const svcHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

export async function rest(path: string, init: { method?: string; body?: unknown; token?: string; prefer?: string } = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: { apikey: init.token ? ANON : SERVICE, Authorization: `Bearer ${init.token ?? SERVICE}`, 'Content-Type': 'application/json', ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(25_000), // a stuck database call must fail loudly, not freeze the test until its time runs out
  });
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

export async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; j: Json }> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, j: await res.json().catch(() => ({})) };
}

async function findUser(email: string): Promise<string | null> {
  // Fastest and most reliable: the app's own users table (filled for every sign-up) holds the same id.
  const q = await rest(`users?email=eq.${encodeURIComponent(email)}&select=id`);
  if (q.status === 200 && Array.isArray(q.data) && q.data[0]?.id) return q.data[0].id;
  // The server may cap the page size, so keep reading pages until one comes back empty.
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${SB}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svcHeaders });
    const j: Json = await res.json().catch(() => ({}));
    const users: Json[] = j.users ?? [];
    const hit = users.find(u => String(u.email).toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length === 0) return null;
  }
  return null;
}

/** Creates the account if needed, sets this run's password, returns the id. */
export async function ensureUser(role: string): Promise<{ id: string; email: string }> {
  const email = `e2e-${role}${DOMAIN}`;
  let id = await findUser(email);
  const body = { email, password: PASSWORD, email_confirm: true, user_metadata: { name: `E2E ${role}` } };
  if (!id) {
    const res = await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: svcHeaders, body: JSON.stringify(body) });
    const j: Json = await res.json();
    if (!res.ok) throw new Error(`could not create ${email}: ${JSON.stringify(j)}`);
    id = j.id;
  } else {
    const res = await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: svcHeaders, body: JSON.stringify({ password: PASSWORD, email_confirm: true }) });
    if (!res.ok) throw new Error(`could not reset ${email}: ${await res.text()}`);
  }
  // The server limits how often one person can do some things (for example 3 coach applications an hour). The same test
  // accounts are reused every run, so their counters are cleared here; otherwise a second run within the hour fails with "too many tries".
  await fetch(`${SB}/rest/v1/v2_rate_limits?user_id=eq.${id}`, { method: 'DELETE', headers: svcHeaders }).catch(() => undefined);
  return { id: id!, email };
}

export async function signIn(email: string): Promise<string> {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j: Json = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}
