// @vitest-environment node
/**
 * UpiPaymentFlow.cf.test.ts — Cloudflare Pages Functions equivalent of
 * UpiPaymentFlow.test.ts, exercising functions/api/extract-utr.ts directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../functions/_shared/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../functions/_shared/auth')>();
  return {
    ...actual,
    verifyJWT: vi.fn().mockResolvedValue({ userId: 'u1', plan: 'pro' }),
    getSupabaseAdmin: () => ({
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob(['fake-image-bytes']),
            error: null,
          }),
          remove: vi.fn().mockResolvedValue({}),
        }),
      },
    }),
  };
});

const { onRequest } = await import('../../../functions/api/extract-utr');

const FAKE_ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  GEMINI_API_KEY: 'fake-gemini',
  APP_URL: 'https://nutrismart-3bb.pages.dev',
};

function makeRequest(imagePath: string): Request {
  return new Request('https://example.com/api/extract-utr', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ image_path: `u1/${imagePath}` }),
  });
}

function mockGeminiOk(text: string) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UpiPaymentFlow (Cloudflare) — extract-utr.ts screenshot parsing', () => {
  it('extracts valid UTR and returns amount_matches:true for ₹99', async () => {
    fetchSpy.mockResolvedValue(mockGeminiOk('{"utr":"TXN426812345678","amount":99}'));
    const res = await onRequest({ request: makeRequest('payment.jpg'), env: FAKE_ENV } as any);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.utr).toBe('TXN426812345678');
    expect(body.amount).toBe(99);
    expect(body.amount_matches).toBe(true);
  });

  it('returns amount_matches:false when amount is not 99', async () => {
    fetchSpy.mockResolvedValue(mockGeminiOk('{"utr":"TXN123456789012","amount":50}'));
    const res = await onRequest({ request: makeRequest('partial.jpg'), env: FAKE_ENV } as any);
    const body = await res.json();
    expect(body.amount_matches).toBe(false);
  });

  it('returns utr:null when Gemini cannot read the screenshot', async () => {
    fetchSpy.mockResolvedValue(mockGeminiOk('{"utr":null,"amount":null}'));
    const res = await onRequest({ request: makeRequest('blurry.jpg'), env: FAKE_ENV } as any);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.utr).toBeNull();
  });

  it('rejects a malformed UTR (too short) from Vision output', async () => {
    fetchSpy.mockResolvedValue(mockGeminiOk('{"utr":"ABC","amount":99}'));
    const res = await onRequest({ request: makeRequest('screenshot.jpg'), env: FAKE_ENV } as any);
    const body = await res.json();
    expect(body.utr).toBeNull();
  });

  it('returns 502 gracefully on Vision network error', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    const res = await onRequest({ request: makeRequest('error.jpg'), env: FAKE_ENV } as any);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('extraction_failed');
  });

  it('rejects if image_path does not start with the user ID', async () => {
    const request = new Request('https://example.com/api/extract-utr', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ image_path: 'other-user-id/screenshot.jpg' }),
    });
    const res = await onRequest({ request, env: FAKE_ENV } as any);
    expect(res.status).toBe(403);
  });

  it('UTR is uppercased before returning', async () => {
    fetchSpy.mockResolvedValue(mockGeminiOk('{"utr":"txn123456789ab","amount":99}'));
    const res = await onRequest({ request: makeRequest('pay.jpg'), env: FAKE_ENV } as any);
    const body = await res.json();
    if (body.utr) {
      expect(body.utr).toBe(body.utr.toUpperCase());
    }
  });

  it('OPTIONS preflight returns 204', async () => {
    const res = await onRequest({
      request: new Request('https://example.com/api/extract-utr', { method: 'OPTIONS' }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(204);
  });
});
