import { defineConfig } from '@playwright/test';

import base from './playwright.config';

/**
 * The launch's pictures only (sprint_7 7.3, 7.4): `pnpm record-demo` (scripts/record-demo.ts) runs tests/e2e/demo.record.ts
 * and `pnpm record-screenshots` (scripts/record-screenshots.ts) runs tests/e2e/store-shots.record.ts, each naming its
 * file, with the end-to-end run's settings but a file pattern of their own, which `pnpm e2e` never matches.
 */
export default defineConfig({
  ...base,
  testMatch: '**/*.record.ts',
  workers: 1,
});
