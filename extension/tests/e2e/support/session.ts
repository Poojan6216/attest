/**
 * One end-to-end session of the shipped build (sprint_2 2.7): a local fixture server, the extension launched in the
 * fixtures' time zone, the route guard (vendor addresses answered from fixtures, nothing reaches the network) and the
 * options page a test asks the ledger from. The observer specs run their tests in one each (tech review TECH-L10: the
 * same harness had been copied into four specs).
 */
import type { Page } from '@playwright/test';

import { type FixtureServer, startFixtureServer } from '../../tools/serve-fixtures';
import { launchExtension, type LaunchedExtension } from './extension';
import { installRouteGuard } from './network-guard';
import { FIXTURE_TIME_ZONE, type VendorRoutes } from './vendor-pages';

export interface VendorSession {
  readonly server: FixtureServer;
  readonly extension: LaunchedExtension;
  readonly routes: VendorRoutes;
  /** An extension page the test asks the ledger from. */
  readonly ledgerPage: Page;
}

export async function startVendorSession(): Promise<VendorSession> {
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    const routes: VendorRoutes = new Map();
    await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
    const ledgerPage = await extension.openExtensionPage('options.html');
    return { server, extension, routes, ledgerPage };
  } catch (error) {
    await extension.close();
    await server.close();
    throw error;
  }
}

export async function endVendorSession(session: VendorSession): Promise<void> {
  await session.extension.close();
  await session.server.close();
}

/** Runs `run` in a fresh session, closed whatever happens. */
export async function withVendorSession(run: (session: VendorSession) => Promise<void>): Promise<void> {
  const session = await startVendorSession();
  try {
    await run(session);
  } finally {
    await endVendorSession(session);
  }
}
