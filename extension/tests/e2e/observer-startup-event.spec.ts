/**
 * A Gmail or Calendar page cannot stop Attest's observers (Decisions [2.close] S5, SEC-3; Hard Rule 6), in the shipped
 * build.
 *
 * WXT's content-script context dispatches a start-up CustomEvent on `document` when a content script starts, and
 * fires `ctx.onInvalidated` when it sees that event from another instance of the same script. DOM events are shared
 * with the page, so any script on mail.google.com that knows Attest's public id could dispatch it. The observers used
 * to stop on `ctx.onInvalidated`: one forged event ended every pass in the tab, silently (the stored health stayed
 * OK). Now the skeleton stops only when the extension context is really gone, so after the forged event the next DOM
 * change still makes a pass whose coverage reaches the ledger.
 *
 * The page can still tell that Attest is installed from the start-up event itself: that is accepted and documented
 * (Decisions [2.close] S5; docs/attacks-that-work.md). This test pins it too, so the documentation cannot go stale.
 */
import { expect, test } from '@playwright/test';

import { instantMs } from '../../src/core/normalize';
import type { LedgerExport } from '../../src/ledger/export';
import { startFixtureServer } from '../tools/serve-fixtures';
import { launchExtension } from './support/extension';
import { installRouteGuard } from './support/network-guard';
import {
  FIXTURE_TIME_ZONE,
  openVendorPage,
  type VendorRoutes,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

/** The latest Gmail Sent sync the ledger holds (its head window's `lastSyncAt`), or undefined. */
function sentSync(ledger: LedgerExport): number | undefined {
  const syncs = ledger.tables.coverageIntervals
    .filter((entry) => entry.source === 'gmail.sent')
    .map((entry) => instantMs(entry.lastSyncAt));
  return syncs.length === 0 ? undefined : Math.max(...syncs);
}

test('a page-made WXT start-up event no longer stops the observers (S5, SEC-3)', async () => {
  test.setTimeout(2 * 60_000);
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    const routes: VendorRoutes = new Map();
    await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
    const ledgerPage = await extension.openExtensionPage('options.html');
    const eventName = `${extension.extensionId}:gmail:wxt:content-script-started`;
    // A page script that listens before the content script starts (the accepted detection).
    await extension.context.addInitScript((name: string) => {
      const heard: unknown[] = [];
      Object.defineProperty(window, '__attestStartup', { value: heard });
      document.addEventListener(name, (event) => {
        if (event instanceof CustomEvent) heard.push(event.detail);
      });
    }, eventName);
    const tab = await openVendorPage(
      extension.context,
      routes,
      vendorFixture('gmail', 'synthetic-sent-page-1.html'),
    );
    const first = await waitForLedger(ledgerPage, (state) => sentSync(state) !== undefined);
    const firstSync = sentSync(first) ?? 0;

    const heard: unknown = await tab.evaluate((): unknown => Reflect.get(window, '__attestStartup'));
    expect(heard).toEqual([expect.objectContaining({ contentScriptName: 'gmail' })]);

    // The forged event, from the page's own world, as another instance of the Gmail content script would send it.
    await tab.evaluate((name: string) => {
      const detail = { contentScriptName: 'gmail', messageId: 'forged-by-the-page' };
      document.dispatchEvent(new CustomEvent(name, { detail }));
    }, eventName);
    // Then the page changes: a running observer reads it again and its coverage moves on.
    await tab.evaluate(() => {
      document.body.append(document.createElement('div'));
    });
    const later = await waitForLedger(ledgerPage, (state) => (sentSync(state) ?? 0) > firstSync);
    expect(later.tables.adapterHealth.find((report) => report.adapterId === 'gmail.sent')).toMatchObject({
      status: 'OK',
    });
  } finally {
    await extension.close();
    await server.close();
  }
});
