import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/integration/test-db-url';

// `npm run test:int` — real-Postgres integration tests (*.int.spec.ts) against <db>_test.
export default defineConfig({
  test: {
    include: ['src/**/*.int.spec.ts'],
    globalSetup: ['./test/integration/global-setup.ts'],
    env: {
      DATABASE_URL: testDatabaseUrl(),
      NODE_ENV: 'test',
      PAYMENTS_ENABLED: 'false',
    },
    // Every file truncates the same database — run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
