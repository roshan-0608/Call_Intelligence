import { defineConfig } from 'vitest/config';

/**
 * One test run for the whole repo.
 *
 * Tests import `@call-intel/shared` through its package entry point rather than
 * by relative path, so they exercise the same build the backend and the frontend
 * consume. `pretest` builds it first.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/test/**/*.test.ts', 'backend/test/**/*.test.ts'],
    // The backend's env module throws on invalid configuration, so the suite runs
    // with a known-good, key-less environment: uploads are expected to 503.
    env: {
      NODE_ENV: 'test',
      // Never connected to: every test stubs the database module.
      DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
      CORS_ORIGINS: '*',
      GROQ_API_KEY: '',
    },
    coverage: {
      include: ['shared/src/**', 'backend/src/**'],
      exclude: [
        '**/*.d.ts',
        // Process entry and CLI entries: exercised by the npm scripts
        // (db:seed, eval, validate:dataset) rather than by the unit suite.
        'backend/src/index.ts',
        'backend/src/seed.ts',
        'backend/src/eval/**',
        'backend/src/processCalls.ts',
        'backend/src/validateDataset.ts',
      ],
      reporter: ['text', 'lcov'],
    },
  },
});
