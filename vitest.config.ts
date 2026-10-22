import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals:     true,
    setupFiles:  ['src/tests/setup.ts'],
    // tests-integration/** and e2e/** are separate suites with their own
    // configs/runners (Vitest with real network, and Playwright
    // respectively) — excluded here so `npm test` stays fast, mocked,
    // and network-free, and so Playwright's `test()` calls in e2e/*.spec.ts
    // are never picked up by Vitest's default *.spec.ts matcher.
    exclude: ['**/node_modules/**', 'tests-integration/**', 'e2e/**'],
    coverage: {
      provider:   'v8',
      reporter:   ['text', 'lcov'],
      include:    ['src/lib/**', 'src/utils/**', 'netlify/functions/**', 'functions/**'],
      exclude:    ['src/tests/**', 'tests-integration/**', 'e2e/**'],
    },
    // node environment for Netlify/Cloudflare functions (they run server-side)
    environmentMatchGlobs: [
      ['src/tests/sync/**',      'happy-dom'],
      ['src/tests/components/**','happy-dom'],
      ['netlify/**',             'node'],
      ['functions/**',           'node'],
    ],
  },
});
