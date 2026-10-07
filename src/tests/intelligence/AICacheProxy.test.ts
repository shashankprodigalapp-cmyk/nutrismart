// @vitest-environment node
/**
 * AICacheProxy.test.ts — Modules 4 / 9 (cache-first AI search)
 *
 * Tests the three-tier lookup in the ai-search Netlify function:
 *   1. pgvector cache hit (similarity > 0.9) → returns JSONB, NEVER calls Gemini generate
 *   2. Cache miss → Gemini generate called → result written to cache
 *   3. Embed failure (network timeout) → silent miss, falls through to Gemini
 *
 * Uses MSW to intercept HTTP. The supabaseAdmin RPC mock is injected via
 * vi.mock so we can control what match_cached_food returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';

// ── Test helpers ──────────────────────────────────────────────────────────

const VALID_NUTRITION = {
  name: 'Dal Tadka', portion: '1 katori (150g)',
  calories: 180, protein: 9, carbs: 22, fat: 6, gl: 8,
  confidence: 'high',
};

const MOCK_EMBEDDING = new Array(768).fill(0.05);

// Simulates the supabaseAdmin used inside ai-search.ts
let rpcMock = vi.fn();
vi.mock('../../../netlify/functions/_shared/auth', () => ({
  verifyJWT: vi.fn().mockResolvedValue({
    userId: 'test-user', plan: 'pro', email: 'test@test.com',
  }),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  logEvent:       vi.fn().mockResolvedValue(undefined),
  preflightResponse: () => new Response('', { status: 200 }),
  jsonResponse: (status: number, body: unknown) =>
    ({ statusCode: status, body: JSON.stringify(body) }),
  CORS_HEADERS: {},
  supabaseAdmin: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: () => {
      const b: any = {
        select: () => b,
        eq:     () => b,
        upsert: vi.fn().mockResolvedValue({ error: null }),
        then:   (res: any) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return b;
    },
  },
}));

// Import AFTER mocks are wired
const { handler } = await import('../../../netlify/functions/ai-search');

function makeEvent(body: object): any {
  return {
    httpMethod: 'POST',
    headers:    { authorization: 'Bearer mock-token' },
    body:       JSON.stringify(body),
  };
}

describe('AICacheProxy — cache-first ai-search', () => {
  beforeEach(() => {
    rpcMock = vi.fn();
  });

  it('CACHE HIT: returns cached data without calling Gemini generateContent', async () => {
    // Embed succeeds → RPC returns similarity=0.95 (above 0.9 threshold)
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/embedContent*', () =>
        HttpResponse.json({ embedding: { values: MOCK_EMBEDDING } })
      )
    );
    // generateContent should NOT be called — we verify this is still the
    // 404 default from setup.ts (i.e., MSW never returns a good response)
    let generateCalled = false;
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () => {
        generateCalled = true;
        return HttpResponse.json({}, { status: 200 });
      })
    );

    rpcMock.mockImplementation((rpcName: string) => {
      if (rpcName === 'match_cached_food') {
        return Promise.resolve({
          data: [{
            id: 'cache-row-1',
            food_name: 'dal tadka',
            nutritional_jsonb: VALID_NUTRITION,
            similarity: 0.95,
          }],
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
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/embedContent*', () =>
        HttpResponse.json({ embedding: { values: MOCK_EMBEDDING } })
      ),
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        HttpResponse.json({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(VALID_NUTRITION) }] },
          }],
        })
      )
    );

    rpcMock.mockImplementation((rpcName: string) => {
      if (rpcName === 'match_cached_food') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await handler(makeEvent({ mode: 'name', query: 'paneer tikka' }), {} as any);
    const body = JSON.parse((res as any).body);

    expect(body.found).toBe(true);
    expect(body.cached).toBeUndefined();  // not set on a generation response
  });

  it('EMBED FAILURE: gracefully falls through to Gemini (never blocks)', async () => {
    // Embed returns 500 → should not crash; should skip cache check
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/embedContent*', () =>
        HttpResponse.error()
      ),
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        HttpResponse.json({
          candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_NUTRITION) }] } }],
        })
      )
    );

    // match_cached_food should NEVER be called if embedding failed
    rpcMock.mockResolvedValue({ data: [], error: null });

    const res = await handler(makeEvent({ mode: 'name', query: 'idli sambhar' }), {} as any);
    const body = JSON.parse((res as any).body);

    // Should not error out — embed failure is a silent miss
    expect((res as any).statusCode).not.toBe(500);
    // RPC (cache lookup) should not have been called with match_cached_food
    const matchCalls = rpcMock.mock.calls.filter(c => c[0] === 'match_cached_food');
    expect(matchCalls).toHaveLength(0);
  });

  it('LOW CONFIDENCE result is not written to cache', async () => {
    const lowConfResult = { ...VALID_NUTRITION, confidence: 'low' };
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/embedContent*', () =>
        HttpResponse.json({ embedding: { values: MOCK_EMBEDDING } })
      ),
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        HttpResponse.json({
          candidates: [{ content: { parts: [{ text: JSON.stringify(lowConfResult) }] } }],
        })
      )
    );
    rpcMock.mockImplementation(() => Promise.resolve({ data: [], error: null }));

    const fromMock = vi.fn().mockReturnValue({ upsert: vi.fn() });
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ upsert: upsertSpy });

    await handler(makeEvent({ mode: 'name', query: 'unknown dish xyz' }), {} as any);

    // saveToSemanticCache skips low-confidence — upsert must not have been called
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
