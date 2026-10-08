import os from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

import { CAPTURE_KEY_ENV } from './tests/tools/capture-key';

// A capture run in an end-to-end test (the CLI it spawns inherits this) never makes or reads the user's own capture
// key (tests/tools/capture-key.ts): the tests pass seeds of their own, and a run without one gets a throwaway file.
process.env[CAPTURE_KEY_ENV] ??= path.join(os.tmpdir(), 'attest-e2e-capture-key');

/**
 * Extension E2E against locally served fixture pages. Never a live vendor (qa_tester rule 1).
 * No retries: a test that passes on retry is a bug (qa_tester rule 10).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  // Assertions wait on asynchronous extension work (the install handler, storage events, page renders).
  // Playwright's 5 s default failed 21 of 48 runs on a loaded machine (QA review, sprint 0): that is the
  // bound on a wait, not a retry; a passing assertion returns as soon as it holds.
  expect: { timeout: 15_000 },
  retries: 0,
  // Each test launches its own Chromium. Uncapped workers on a loaded machine hung browser launches (QA-4):
  // CI runs one, a local run two.
  workers: process.env.CI ? 1 : 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
