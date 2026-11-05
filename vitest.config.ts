import { configDefaults, defineConfig } from 'vitest/config';

// `npm test` — fast unit/mocked suite. Real-DB integration tests run separately via `npm run test:int`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts'],
    // Run in a zone far from the Caribbean ports so server zone leaks fail tests (spec 0003).
    env: { TZ: 'Asia/Dhaka' },
  },
});
