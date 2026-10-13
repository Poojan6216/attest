import { defineConfig } from '@playwright/test';

import base from './playwright.config';

/**
 * `pnpm record-demo` only (sprint_7 7.3; scripts/record-demo.ts): the build_spec §2 demo recorded as frames by
 * tests/e2e/demo.record.ts, with the end-to-end run's settings but its file pattern, which `pnpm e2e` never matches.
 */
export default defineConfig({
  ...base,
  testMatch: '**/*.record.ts',
  workers: 1,
});
