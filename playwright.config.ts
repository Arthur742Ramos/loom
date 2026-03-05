import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  use: {
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'electron-e2e',
      testMatch: 'e2e/**/*.spec.ts',
    },
    {
      name: 'electron-visual',
      testMatch: 'visual/**/*.spec.ts',
    },
  ],
});
