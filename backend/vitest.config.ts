import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database, integration and concurrency suites share one test database.
    fileParallelism: false,
    env: { VITEST: 'true' },
  },
});
