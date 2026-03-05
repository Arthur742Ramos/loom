import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['tests/unit/setup.ts'],
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/unit/main/**', 'node'],
      ['tests/unit/renderer/**', 'jsdom'],
    ],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
