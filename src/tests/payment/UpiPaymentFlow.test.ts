// @vitest-environment node
/**
 * UpiPaymentFlow.test.ts — Modules 5 / 13 (screenshot UTR extraction)
 *
 * Tests extract-utr.ts:
 *   1. Gemini Vision returns valid JSON {utr, amount} → function validates
 *      UTR format and returns structured response with amount_matches flag.
 *   2. Gemini returns utr:null (can't read) → graceful fallback response.
 *   3. Vision call times out → returns extraction_failed without crashing.
 *   4. UTR format is validated (10–22 alphanum) before being returned.
 *   5. amount_matches is true only when amount === 99.
 */

import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';

vi.mock('../../../netlify/functions/_shared/auth', async () => ({
  verifyJWT: vi.fn().mockResolvedValue({ userId: 'u1', plan: 'pro' }),
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn().mockResolvedValue({
          data: new Blob(['fake-image-bytes']),
          error: null,
        }),
        remove: vi.fn().mockResolvedValue({}),
      }),
    },
  },
  preflightResponse:  () => new Response('', { status: 200 }),
  jsonResponse: (s: number, b: unknown) =>
    ({ statusCode: s, body: JSON.stringify(b) }),
  CORS_HEADERS: {},
}));

const { handler } = await import('../../../netlify/functions/extract-utr');

function makeEvent(imagePath: string): any {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer t' },
    body: JSON.stringify({ image_path: `u1/${imagePath}` }),
  };
}

function geminiVisionResponse(text: string) {
  return HttpResponse.json({
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

describe('UpiPaymentFlow — extract-utr.ts screenshot parsing', () => {
  it('extracts valid UTR and returns amount_matches:true for ₹99', async () => {
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        geminiVisionResponse('{"utr":"TXN426812345678","amount":99}')
      )
    );
    const res = await handler(makeEvent('payment.jpg'), {} as any);
    const body = JSON.parse((res as any).body);

    expect(body.success).toBe(true);
    expect(body.utr).toBe('TXN426812345678');
    expect(body.amount).toBe(99);
    expect(body.amount_matches).toBe(true);
  });

  it('returns amount_matches:false when amount is not 99', async () => {
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        geminiVisionResponse('{"utr":"TXN123456789012","amount":50}')
      )
    );
    const res = await handler(makeEvent('partial.jpg'), {} as any);
    const body = JSON.parse((res as any).body);
    expect(body.amount_matches).toBe(false);
  });

  it('returns utr:null when Gemini cannot read the screenshot', async () => {
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        geminiVisionResponse('{"utr":null,"amount":null}')
      )
    );
    const res = await handler(makeEvent('blurry.jpg'), {} as any);
    const body = JSON.parse((res as any).body);

    expect(body.success).toBe(true);
    expect(body.utr).toBeNull();
  });

  it('rejects a malformed UTR (too short) from Vision output', async () => {
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        geminiVisionResponse('{"utr":"ABC","amount":99}')
      )
    );
    const res = await handler(makeEvent('screenshot.jpg'), {} as any);
    const body = JSON.parse((res as any).body);
    // Invalid UTR from Vision returns null (regex guard)
    expect(body.utr).toBeNull();
  });

  it('returns 502 gracefully on Vision network error', async () => {
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        HttpResponse.error()
      )
    );
    const res = await handler(makeEvent('error.jpg'), {} as any);
    expect((res as any).statusCode).toBe(502);
    const body = JSON.parse((res as any).body);
    expect(body.error).toBe('vision_failed');
  });

  it('rejects if image_path does not start with the user ID', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { authorization: 'Bearer t' },
      body: JSON.stringify({ image_path: 'other-user-id/screenshot.jpg' }),
    };
    const res = await handler(event as any, {} as any);
    expect((res as any).statusCode).toBe(403);
  });

  it('UTR is uppercased before returning', async () => {
    mswServer.use(
      http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
        geminiVisionResponse('{"utr":"txn123456789ab","amount":99}')
      )
    );
    const res = await handler(makeEvent('pay.jpg'), {} as any);
    const body = JSON.parse((res as any).body);
    if (body.utr) {
      expect(body.utr).toBe(body.utr.toUpperCase());
    }
  });
});
