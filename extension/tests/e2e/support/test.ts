/**
 * Playwright `test` with Attest fixtures:
 *  - `fixtures`: a localhost server for tests/fixtures/pages (one per worker)
 *  - `attest`: the extension loaded in a fresh Chromium profile (one per test)
 */
import { test as base } from '@playwright/test';

import { type FixtureServer, startFixtureServer } from '../../tools/serve-fixtures';
import { type LaunchedExtension, launchExtension } from './extension';

interface TestFixtures {
  attest: LaunchedExtension;
}

interface WorkerFixtures {
  fixtures: FixtureServer;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  fixtures: [
    async ({}, use) => {
      const server = await startFixtureServer();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],
  attest: async ({}, use) => {
    const launched = await launchExtension();
    await use(launched);
    await launched.close();
  },
});

export { expect } from '@playwright/test';
