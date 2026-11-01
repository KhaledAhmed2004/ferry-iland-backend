import { configDefaults, defineConfig } from 'vitest/config';

// `npm test` — fast unit/mocked suite. Real-DB integration tests run separately via `npm run test:int`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int.spec.ts'],
  },
});
