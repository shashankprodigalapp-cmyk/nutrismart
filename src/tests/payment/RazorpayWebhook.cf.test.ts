// @vitest-environment node
/**
 * RazorpayWebhook.cf.test.ts — new coverage for functions/api/razorpay-webhook.ts,
 * previously untested end-to-end (only the HMAC *signing* math had implicit
 * coverage elsewhere). Builds a real HMAC-SHA256 signature with Web Crypto
 * (the same primitive the handler uses) and replays payload shapes matching
 * Razorpay's documented webhook format:
 * https://razorpay.com/docs/webhooks/payloads/subscriptions/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const WEBHOOK_SECRET = 'test-webhook-secret';

let tables: Record<string, any[]>;
let rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

function makeFakeSupabase() {
  return {
    from: (table: string) => {
      const rows = tables[table] ?? (tables[table] = []);
      const builder: any = {
        _filters: [] as Array<[string, any]>,
        eq(col: string, val: any) { this._filters.push([col, val]); return this; },
        select() { return this; },
        single: async () => ({ data: null, error: null }),
        insert: (row: any) => {
          const existing = rows.find((r) => r.event_id === row.event_id);
          if (existing) {
            return {
              select: () => ({
                single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }),
              }),
            };
          }
          rows.push(row);
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
        update: (patch: any) => ({
          eq: async (col: string, val: any) => {
            const row = rows.find((r) => r[col] === val);
            if (row) Object.assign(row, patch);
            return { data: row ?? null, error: null };
          },
        }),
        maybeSingle: async () => {
          const match = rows.find((r) =>
            builder._filters.every(([col, val]: [string, any]) => r[col] === val),
          );
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
    rpc: (...args: any[]) => rpcMock(...args),
  };
}

vi.mock('../../../functions/_shared/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../functions/_shared/auth')>();
  return {
    ...actual,
    getSupabaseAdmin: () => makeFakeSupabase(),
  };
});

const { onRequest } = await import('../../../functions/api/razorpay-webhook');

const FAKE_ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

async function sign(rawBody: string, secret = WEBHOOK_SECRET): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeSignedRequest(payload: object, secret?: string): Promise<Request> {
  const rawBody = JSON.stringify(payload);
  const signature = await sign(rawBody, secret);
  return new Request('https://example.com/api/razorpay-webhook', {
    method: 'POST',
    headers: { 'x-razorpay-signature': signature, 'content-type': 'application/json' },
    body: rawBody,
  });
}

const SUBSCRIPTION_CHARGED_PAYLOAD = {
  entity: 'event',
  account_id: 'acc_test',
  event: 'subscription.charged',
  contains: ['subscription', 'payment'],
  payload: {
    subscription: {
      entity: {
        id: 'sub_test123',
        plan_id: 'plan_test',
        status: 'active',
        current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      },
    },
  },
};

describe('razorpay-webhook — signature verification', () => {
  beforeEach(() => {
    tables = {};
    rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
  });

  it('rejects a request with no signature header', async () => {
    const res = await onRequest({
      request: new Request('https://example.com/api/razorpay-webhook', {
        method: 'POST',
        body: JSON.stringify(SUBSCRIPTION_CHARGED_PAYLOAD),
      }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Missing signature');
  });

  it('rejects a request with a wrong signature', async () => {
    const rawBody = JSON.stringify(SUBSCRIPTION_CHARGED_PAYLOAD);
    const res = await onRequest({
      request: new Request('https://example.com/api/razorpay-webhook', {
        method: 'POST',
        headers: { 'x-razorpay-signature': '00'.repeat(32) },
        body: rawBody,
      }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid signature');
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const request = await makeSignedRequest(SUBSCRIPTION_CHARGED_PAYLOAD, 'wrong-secret');
    const res = await onRequest({ request, env: FAKE_ENV } as any);
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed payload and processes subscription.charged', async () => {
    tables = { subscriptions: [{ razorpay_sub_id: 'sub_test123', user_id: 'user-1' }] };
    const request = await makeSignedRequest(SUBSCRIPTION_CHARGED_PAYLOAD);
    const res = await onRequest({ request, env: FAKE_ENV } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('processed');
    expect(body.event).toBe('subscription.charged');

    const updated = tables.subscriptions.find((r) => r.razorpay_sub_id === 'sub_test123');
    expect(updated.status).toBe('active');
  });

  it('is idempotent: a duplicate event_id is reported as already_processed', async () => {
    tables = {
      subscriptions: [{ razorpay_sub_id: 'sub_test123', user_id: 'user-1' }],
      processed_webhooks: [{ event_id: `subscription.charged:sub_test123` }],
    };
    const request = await makeSignedRequest(SUBSCRIPTION_CHARGED_PAYLOAD);
    const res = await onRequest({ request, env: FAKE_ENV } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('already_processed');
  });

  it('rejects non-POST methods', async () => {
    const res = await onRequest({
      request: new Request('https://example.com/api/razorpay-webhook', { method: 'GET' }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(405);
  });

  it('returns 400 on invalid JSON even with a valid signature', async () => {
    const rawBody = 'not json';
    const signature = await sign(rawBody);
    const res = await onRequest({
      request: new Request('https://example.com/api/razorpay-webhook', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signature },
        body: rawBody,
      }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid JSON');
  });
});
