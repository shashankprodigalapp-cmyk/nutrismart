/**
 * src/tests/setup.ts — Global test setup for all NutriSmart tests.
 *
 * Runs once before every test file via vitest.config.ts `setupFiles`.
 * Provides:
 *   - fake-indexeddb shim so Dexie tests run in Node/happy-dom
 *   - MSW server wired to intercept all external HTTP (Gemini, Netlify fns)
 *   - navigator.onLine = true by default (individual tests override)
 *   - navigator.locks polyfill (web-locks not in happy-dom)
 *   - Supabase client stub (channel, from, rpc) returning safe defaults
 */

import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// ── MSW server (catch all, handlers added per-test) ────────────────────────
export const mswServer = setupServer(
  // Default: Gemini embed endpoint — returns a valid 768-dim zero vector
  http.post('https://generativelanguage.googleapis.com/*/embedContent*', () =>
    HttpResponse.json({ embedding: { values: new Array(768).fill(0.01) } })
  ),
  // Default: Gemini generate endpoint — 404 to confirm tests that expect
  // cache hits never call it
  http.post('https://generativelanguage.googleapis.com/*/generateContent*', () =>
    HttpResponse.json({ error: { message: 'SHOULD_NOT_BE_CALLED' } }, { status: 404 })
  ),
);

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

// ── navigator.onLine default ───────────────────────────────────────────────
Object.defineProperty(navigator, 'onLine', {
  configurable: true,
  get: () => true,
});

// ── Web Locks API polyfill ─────────────────────────────────────────────────
// happy-dom and jsdom do not implement the Web Locks API.
// This polyfill makes the non-blocking branch (`ifAvailable: true`) testable.
const lockGranted: Record<string, boolean> = {};
Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request(
      name: string,
      opts: { ifAvailable: boolean },
      callback: (lock: { name: string } | null) => Promise<void>,
    ): Promise<void> {
      if (opts?.ifAvailable) {
        if (lockGranted[name]) {
          return callback(null);          // lock already held — denied
        }
        lockGranted[name] = true;
        return callback({ name }).finally(() => { lockGranted[name] = false; });
      }
      lockGranted[name] = true;
      return callback({ name }).finally(() => { lockGranted[name] = false; });
    },
  },
});

// ── Supabase client stub ───────────────────────────────────────────────────
// Prevents real HTTP calls from any module that imports supabase.ts.
// Tests that need specific responses override via vi.mock or mswServer.
vi.mock('../lib/supabase', () => {
  const channel = {
    on:        () => channel,
    subscribe: () => channel,
  };
  const builder = {
    select:  () => builder,
    from:    () => builder,
    eq:      () => builder,
    order:   () => builder,
    limit:   () => builder,
    gte:     () => builder,
    filter:  () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    toArray: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        getUser:    () => Promise.resolve({ data: { user: null  } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
      from:    () => builder,
      channel: () => channel,
      rpc:     () => Promise.resolve({ data: null, error: null }),
      removeChannel: vi.fn(),
      storage: { from: () => ({ download: vi.fn(), remove: vi.fn() }) },
    },
  };
});
