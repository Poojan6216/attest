import { defineConfig } from '@playwright/test';

/**
 * Extension E2E against locally served fixture pages. Never a live vendor (qa_tester rule 1).
 * No retries: a test that passes on retry is a bug (qa_tester rule 10).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
