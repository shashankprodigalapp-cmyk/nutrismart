import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals:     true,
    setupFiles:  ['src/tests/setup.ts'],
    coverage: {
      provider:   'v8',
      reporter:   ['text', 'lcov'],
      include:    ['src/lib/**', 'src/utils/**', 'netlify/functions/**'],
      exclude:    ['src/tests/**'],
    },
    // node environment for netlify functions (they run in Node 18)
    environmentMatchGlobs: [
      ['src/tests/sync/**',      'happy-dom'],
      ['src/tests/components/**','happy-dom'],
      ['netlify/**',             'node'],
    ],
  },
});
