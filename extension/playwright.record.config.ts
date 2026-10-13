import { defineConfig } from '@playwright/test';

import base from './playwright.config';

/**
 * The launch's pictures only (sprint_7 7.3, 7.4): `pnpm record-demo` and `pnpm record-screenshots`
 * (scripts/record-launch.ts) run tests/e2e/demo.record.ts and tests/e2e/store-shots.record.ts, each naming its file,
 * with the end-to-end run's settings but a file pattern of their own, which `pnpm e2e` never matches. Their flows are
 * tests/e2e/support/launch-shots.ts, which `pnpm e2e` runs too (tests/e2e/launch-shots.spec.ts), writing nothing.
 */
export default defineConfig({
  ...base,
  testMatch: '**/*.record.ts',
  workers: 1,
});
