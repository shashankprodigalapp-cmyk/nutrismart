// @vitest-environment node
/**
 * AICacheProxy.test.ts — Modules 4 / 9 (cache-first AI search)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const VALID_NUTRITION = {
  name: 'Dal Tadka', portion: '1 katori (150g)',
  calories: 180, protein: 9, carbs: 22, fat: 6, gl: 8,
  confidence: 'high',
};

const MOCK_EMBEDDING = new Array(768).fill(0.05);

let rpcMock = vi.fn();

vi.mock('../../../netlify/functions/_shared/auth', () => ({
  verifyJWT: vi.fn().mockResolvedValue({ userId: 'test-user', plan: 'pro', email: 'test@test.com' }),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  logEvent: vi.fn().mockResolvedValue(undefined),
  preflightResponse: () => new Response('', { status: 200 }),
  jsonResponse: (status: number, body: unknown) =>
    ({ statusCode: status, body: JSON.stringify(body) }),
  CORS_HEADERS: {},
  supabaseAdmin: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: () => {
      const b: any = {
        select: () => b,
        eq: () => b,
        upsert: vi.fn().mockResolvedValue({ error: null }),
        then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return b;
    },
  },
}));

const { handler } = await import('../../../netlify/functions/ai-search');

function makeEvent(body: object): any {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer mock-token' },
    body: JSON.stringify(body),
  };
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
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AICacheProxy — cache-first ai-search', () => {
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

    const res = await handler(makeEvent({ mode: 'name', query: 'dal tadka' }), {} as any);
    const body = JSON.parse((res as any).body);

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

    const res = await handler(makeEvent({ mode: 'name', query: 'paneer tikka' }), {} as any);
    const body = JSON.parse((res as any).body);

    expect(body.found).toBe(true);
    expect(body.cached).toBeUndefined();
  });

  it('EMBED FAILURE: gracefully falls through to Gemini (never blocks)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('embedContent')) return Promise.reject(new Error('network error'));
      return mockFetchGenerate(VALID_NUTRITION);
    });

    rpcMock.mockResolvedValue({ data: [], error: null });

    const res = await handler(makeEvent({ mode: 'name', query: 'idli sambhar' }), {} as any);

    expect((res as any).statusCode).not.toBe(500);
    const matchCalls = rpcMock.mock.calls.filter((c: any[]) => c[0] === 'match_cached_food');
    expect(matchCalls).toHaveLength(0);
  });

  it('LOW CONFIDENCE result is not written to cache', async () => {
    const lowConfResult = { ...VALID_NUTRITION, confidence: 'low' };
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });

    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('embedContent')) return mockFetchEmbed();
      return mockFetchGenerate(lowConfResult);
    });

    rpcMock.mockImplementation(() => Promise.resolve({ data: [], error: null }));

    await handler(makeEvent({ mode: 'name', query: 'unknown dish xyz' }), {} as any);

    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
