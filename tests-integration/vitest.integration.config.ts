import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-integration/**/*.int.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Sequential by default: these hit a real deployment and a real
    // Supabase rate limiter, so parallel workers would trip each other's
    // rate-limit counters and produce flaky false negatives.
    fileParallelism: false,
  },
});
