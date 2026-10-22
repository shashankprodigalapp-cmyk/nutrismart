/**
 * tests-integration/api.int.test.ts — Layer B
 *
 * Exercises the real, deployed Cloudflare Pages Functions. See
 * tests-integration/README.md for required env vars and what is
 * deliberately NOT covered here (anything with side effects on
 * production data).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { BASE_URL, getTestUserToken } from './helpers/auth';

let token: string;

beforeAll(async () => {
  token = await getTestUserToken();
});

const AUTH_REQUIRED_ENDPOINTS = [
  { path: '/api/analyze-energy', method: 'GET' },
  { path: '/api/get-upload-url', method: 'POST', body: { fileName: 'test.jpg', bucket: 'meal-photos' } },
  { path: '/api/cron-morning-verdict', method: 'GET' },
  { path: '/api/ai-search', method: 'POST', body: { mode: 'name', query: 'dal' } },
  { path: '/api/ai-vision', method: 'POST', body: {} },
  { path: '/api/extract-utr', method: 'POST', body: {} },
  { path: '/api/get-admin-analytics', method: 'GET' },
];

describe('Live deployment — auth is enforced', () => {
  for (const ep of AUTH_REQUIRED_ENDPOINTS) {
    it(`${ep.method} ${ep.path} rejects a missing Authorization header`, async () => {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: ep.body ? { 'content-type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      expect(res.status).toBe(401);
    });

    it(`${ep.method} ${ep.path} rejects a garbage Authorization header`, async () => {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: {
          authorization: 'Bearer not-a-real-token',
          ...(ep.body ? { 'content-type': 'application/json' } : {}),
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      expect(res.status).toBe(401);
    });
  }
});

describe('Live deployment — CORS preflight', () => {
  for (const path of ['/api/ai-search', '/api/analyze-energy', '/api/get-upload-url']) {
    it(`OPTIONS ${path} returns CORS headers`, async () => {
      const res = await fetch(`${BASE_URL}${path}`, { method: 'OPTIONS' });
      expect([200, 204]).toContain(res.status);
      expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
      expect(res.headers.get('access-control-allow-methods')).toBeTruthy();
    });
  }
});

describe('Live deployment — authenticated happy path (read-only endpoints)', () => {
  it('GET /api/analyze-energy returns a well-formed report for the test user', async () => {
    const res = await fetch(`${BASE_URL}/api/analyze-energy`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Shape check only — the test user may have no logs yet, which is fine.
    expect(body).toHaveProperty('hasEnoughData');
  });

  it('GET /api/cron-morning-verdict returns a verdict payload for the test user', async () => {
    const res = await fetch(`${BASE_URL}/api/cron-morning-verdict`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('POST /api/get-upload-url issues a signed URL for the test user', async () => {
    const res = await fetch(`${BASE_URL}/api/get-upload-url`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'integration-test.jpg', bucket: 'meal-photos' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.uploadUrl ?? body.signedUrl).not.toBe('undefined');
  });
});

describe('Live deployment — rate limiting', () => {
  it('GET /api/get-admin-analytics returns 403 for a non-admin test user', async () => {
    // The dedicated integration-test user should never be in admin_users.
    const res = await fetch(`${BASE_URL}/api/get-admin-analytics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect([401, 403]).toContain(res.status);
  });
});
