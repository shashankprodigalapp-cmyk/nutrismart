// @vitest-environment node
/**
 * AICacheProxy.cf.test.ts — Cloudflare Pages Functions equivalent of
 * AICacheProxy.test.ts, exercising functions/api/ai-search.ts directly
 * (the code that actually runs in production since the Netlify -> Cloudflare
 * migration). Kept alongside the original Netlify-handler test so both
 * trees stay covered until netlify/functions/ is retired.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const VALID_NUTRITION = {
  name: 'Dal Tadka', portion: '1 katori (150g)',
  calories: 180, protein: 9, carbs: 22, fat: 6, gl: 8,
  confidence: 'high',
};

const MOCK_EMBEDDING = new Array(768).fill(0.05);

let rpcMock = vi.fn();
let upsertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('../../../functions/_shared/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../functions/_shared/auth')>();
  return {
    ...actual,
    verifyJWT: vi.fn().mockResolvedValue({ userId: 'test-user', plan: 'pro' }),
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    logEvent: vi.fn().mockResolvedValue(undefined),
    getSupabaseAdmin: () => ({
      rpc: (...args: any[]) => rpcMock(...args),
      from: () => ({ upsert: upsertMock }),
    }),
  };
});

const { onRequest } = await import('../../../functions/api/ai-search');

const FAKE_ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  GEMINI_API_KEY: 'fake-gemini',
  CLAUDE_API_KEY: 'fake-claude',
  APP_URL: 'https://nutrismart-3bb.pages.dev',
};

function makeRequest(body: object): Request {
  return new Request('https://example.com/api/ai-search', {
    method: 'POST',
    headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockFetchEmbed() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ embedding: { values: MOCK_EMBEDDING } }),
  });
}

function mockFetchGenerate(nutrition: object) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      candidates: [{ content: { parts: [{ text: JSON.stringify(nutrition) }] } }],
    }),
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpcMock = vi.fn();
  upsertMock = vi.fn().mockResolvedValue({ error: null });
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AICacheProxy (Cloudflare) — cache-first ai-search', () => {
  it('CACHE HIT: returns cached data without calling Gemini generateContent', async () => {
    let generateCalled = false;
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('embedContent')) return mockFetchEmbed();
      generateCalled = true;
      return mockFetchGenerate(VALID_NUTRITION);
    });

    rpcMock.mockImplementation((rpcName: string) => {
      if (rpcName === 'match_cached_food') {
        return Promise.resolve({
          data: [{ id: 'cache-row-1', food_name: 'dal tadka', nutritional_jsonb: VALID_NUTRITION, similarity: 0.95 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const res = await onRequest({
      request: makeRequest({ mode: 'name', query: 'dal tadka' }),
      env: FAKE_ENV,
    } as any);
    const body = await res.json();

    expect(body.found).toBe(true);
    expect(body.cached).toBe(true);
    expect(body.similarity).toBeCloseTo(0.95, 2);
    expect(body.result.name).toBe('Dal Tadka');
    expect(generateCalled).toBe(false);
  });

  it('CACHE MISS: calls Gemini when RPC returns empty', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('embedContent')) return mockFetchEmbed();
      return mockFetchGenerate(VALID_NUTRITION);
    });

    rpcMock.mockImplementation((rpcName: string) => {
      if (rpcName === 'match_cached_food') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await onRequest({
      request: makeRequest({ mode: 'name', query: 'paneer tikka' }),
      env: FAKE_ENV,
    } as any);
    const body = await res.json();

    expect(body.found).toBe(true);
    expect(body.cached).toBeUndefined();
  });

  it('EMBED FAILURE: gracefully falls through to Gemini (never blocks)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('embedContent')) return Promise.reject(new Error('network error'));
      return mockFetchGenerate(VALID_NUTRITION);
    });

    rpcMock.mockResolvedValue({ data: [], error: null });

    const res = await onRequest({
      request: makeRequest({ mode: 'name', query: 'idli sambhar' }),
      env: FAKE_ENV,
    } as any);

    expect(res.status).not.toBe(500);
    const matchCalls = rpcMock.mock.calls.filter((c: any[]) => c[0] === 'match_cached_food');
    expect(matchCalls).toHaveLength(0);
  });

  it('LOW CONFIDENCE result is not written to cache', async () => {
    const lowConfResult = { ...VALID_NUTRITION, confidence: 'low' };

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('embedContent')) return mockFetchEmbed();
      return mockFetchGenerate(lowConfResult);
    });

    rpcMock.mockImplementation(() => Promise.resolve({ data: [], error: null }));

    await onRequest({
      request: makeRequest({ mode: 'name', query: 'unknown dish xyz' }),
      env: FAKE_ENV,
    } as any);

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('UNAUTHORIZED: returns 401 when verifyJWT resolves null', async () => {
    const authModule = await import('../../../functions/_shared/auth');
    (authModule.verifyJWT as any).mockResolvedValueOnce(null);

    const res = await onRequest({
      request: makeRequest({ mode: 'name', query: 'dal tadka' }),
      env: FAKE_ENV,
    } as any);

    expect(res.status).toBe(401);
  });

  it('OPTIONS preflight returns CORS headers with no body', async () => {
    const res = await onRequest({
      request: new Request('https://example.com/api/ai-search', { method: 'OPTIONS' }),
      env: FAKE_ENV,
    } as any);

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(FAKE_ENV.APP_URL);
  });

  it('INVALID MODE: returns 400 invalid_mode', async () => {
    const res = await onRequest({
      request: makeRequest({ mode: 'photo', query: 'dal tadka' }),
      env: FAKE_ENV,
    } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_mode');
  });
});
