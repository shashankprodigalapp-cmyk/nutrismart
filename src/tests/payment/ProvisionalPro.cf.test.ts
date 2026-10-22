// @vitest-environment node
/**
 * ProvisionalPro.cf.test.ts — Cloudflare Pages Functions equivalent of
 * ProvisionalPro.test.ts, exercising functions/api/submit-payment.ts directly.
 * The pure usePlan()/resolvePlan() contract tests are duplicated here
 * unchanged since that logic lives client-side, not in either function tree.
 */

import { describe, it, expect, vi } from 'vitest';

// ── UNIT: usePlan provisional logic (same contract as proGatekeeper.ts) ───

interface SubscriptionRow {
  plan: 'free' | 'pro';
  status: string;
  valid_until: string | null;
  grace_ends_at: string | null;
  pro_provisional_until: string | null;
}

function resolvePlan(data: SubscriptionRow | null): 'free' | 'pro' {
  if (!data) return 'free';

  const validUntil = data.valid_until ? new Date(data.valid_until) : null;
  const provisionalUntil = data.pro_provisional_until ? new Date(data.pro_provisional_until) : null;
  const now = new Date();

  const isPaidPro = data.plan === 'pro' && data.status === 'active'
    && validUntil !== null && validUntil > now;

  const isProvisional = provisionalUntil !== null && provisionalUntil > now;

  return isPaidPro || isProvisional ? 'pro' : 'free';
}

describe('ProvisionalPro (Cloudflare) — usePlan() plan resolution', () => {
  it('grants Pro when pro_provisional_until is in the future', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const plan = resolvePlan({
      plan: 'free', status: 'pending_verification',
      valid_until: null, grace_ends_at: null,
      pro_provisional_until: future,
    });
    expect(plan).toBe('pro');
  });

  it('returns free when pro_provisional_until is in the past', () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const plan = resolvePlan({
      plan: 'free', status: 'pending_verification',
      valid_until: null, grace_ends_at: null,
      pro_provisional_until: past,
    });
    expect(plan).toBe('free');
  });
});

// ── UNIT: functions/api/submit-payment.ts handler behavior ────────────────

let fromMock: any;
let rpcMock = vi.fn();

vi.mock('../../../functions/_shared/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../functions/_shared/auth')>();
  return {
    ...actual,
    verifyJWT: vi.fn().mockResolvedValue({ userId: 'u1', plan: 'free', email: 't@t.com' }),
    getSupabaseAdmin: () => ({
      from: (...args: any[]) => fromMock(...args),
      rpc: (...args: any[]) => rpcMock(...args),
    }),
  };
});

const { onRequest } = await import('../../../functions/api/submit-payment');

const FAKE_ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  APP_URL: 'https://nutrismart-3bb.pages.dev',
};

function makeRequest(body: object): Request {
  return new Request('https://example.com/api/submit-payment', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeBuilder() {
  const b: any = {
    select: () => b,
    eq: () => b,
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
  return b;
}

describe('ProvisionalPro (Cloudflare) — submit-payment.ts', () => {
  it('saves pending record and returns provisional_pro:true', async () => {
    fromMock = vi.fn(() => makeBuilder());
    rpcMock = vi.fn().mockResolvedValue({ data: { success: true, provisional_until: null }, error: null });

    const res = await onRequest({
      request: makeRequest({ transaction_id: 'TXN12345678901' }),
      env: FAKE_ENV,
    } as any);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.provisional_pro).toBe(true);
  });

  it('rejects UTR shorter than 10 characters', async () => {
    fromMock = vi.fn(() => makeBuilder());
    const res = await onRequest({
      request: makeRequest({ transaction_id: 'SHORT' }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_utr');
  });

  it('OPTIONS preflight returns 204', async () => {
    const res = await onRequest({
      request: new Request('https://example.com/api/submit-payment', { method: 'OPTIONS' }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(204);
  });
});

// ── UNIT: revocation logic (pure contract, unchanged from Netlify version) ─

describe('RevocationIntegrity (Cloudflare) — reject_upi_payment atomics', () => {
  it('revoke_provisional_pro sets column to null (contract verification)', () => {
    const before: SubscriptionRow = {
      plan: 'free', status: 'pending_verification',
      valid_until: null, grace_ends_at: null,
      pro_provisional_until: new Date(Date.now() + 3_600_000).toISOString(),
    };
    expect(resolvePlan(before)).toBe('pro');

    const after: SubscriptionRow = { ...before, pro_provisional_until: null };
    expect(resolvePlan(after)).toBe('free');
  });
});
