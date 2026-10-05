/**
 * A page that is offline, or has only just come back, posts no coverage (Decisions [2.close] S4, QA-V2; Hard Rule 5),
 * in the shipped build, with Chromium's own network state (Playwright takes the context offline, so the page sees
 * `navigator.onLine` false and the `online` event when it comes back).
 *
 * The labelled Sent list is opened at Gmail's address. While the context is offline a send appears on the page (a row
 * added by the test): the pass stores it, since what the page shows is evidence, but the head window's sync does not
 * move. Back online, the pass the change starts still posts no coverage, and none does until PAGE_RESYNC_MS after the
 * page came back, when the skeleton asks for a pass on its own and the window's sync moves on.
 */
import { expect, type Page, test } from '@playwright/test';

import { PAGE_RESYNC_MS } from '../../src/config';
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

/** The latest Gmail Sent sync the ledger holds, or undefined. */
function sentSync(ledger: LedgerExport): number | undefined {
  const syncs = ledger.tables.coverageIntervals
    .filter((entry) => entry.source === 'gmail.sent')
    .map((entry) => instantMs(entry.lastSyncAt));
  return syncs.length === 0 ? undefined : Math.max(...syncs);
}

const sentRows = (ledger: LedgerExport): number =>
  ledger.tables.observations.filter((row) => row.source === 'gmail.sent').length;

/** A new send on the page: the first row again, with an id, a recipient and a minute of its own. */
async function addSend(tab: Page, n: number): Promise<void> {
  await tab.evaluate((index: number) => {
    const first = document.querySelector('[role="main"] [role="row"]');
    if (first === null) throw new Error('no row to copy');
    const row = first.cloneNode(true);
    if (!(row instanceof Element)) throw new Error('not an element');
    const id = `1a101ff21e04e7${String(60 + index)}`;
    for (const name of [
      'data-legacy-thread-id',
      'data-legacy-last-message-id',
      'data-legacy-last-non-draft-message-id',
    ]) {
      for (const el of row.querySelectorAll(`[${name}]`)) el.setAttribute(name, id);
    }
    for (const el of row.querySelectorAll('[email]')) {
      el.setAttribute('email', `new.recipient${String(index)}@example.com`);
      el.setAttribute('data-hovercard-id', `new.recipient${String(index)}@example.com`);
    }
    for (const el of row.querySelectorAll('[title]')) {
      const title = el.getAttribute('title') ?? '';
      if (title.includes('9:41')) el.setAttribute('title', title.replace('9:41', `9:${String(50 + index)}`));
    }
    first.before(row);
  }, n);
}

test('offline, and just back online, a Gmail tab stores what it shows but posts no coverage (S4, QA-V2)', async () => {
  test.setTimeout(3 * 60_000);
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    const routes: VendorRoutes = new Map();
    await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
    const ledgerPage = await extension.openExtensionPage('options.html');
    const tab = await openVendorPage(
      extension.context,
      routes,
      vendorFixture('gmail', 'synthetic-sent-page-1.html'),
    );
    const first = await waitForLedger(ledgerPage, (state) => sentSync(state) !== undefined);
    const firstSync = sentSync(first) ?? 0;
    const firstRows = sentRows(first);

    await extension.context.setOffline(true);
    expect(await tab.evaluate(() => navigator.onLine)).toBe(false);
    await addSend(tab, 1);
    const offline = await waitForLedger(ledgerPage, (state) => sentRows(state) === firstRows + 1);
    expect(sentSync(offline)).toBe(firstSync);

    await extension.context.setOffline(false);
    const backAt = Date.now();
    expect(await tab.evaluate(() => navigator.onLine)).toBe(true);
    await addSend(tab, 2);
    const catchingUp = await waitForLedger(ledgerPage, (state) => sentRows(state) === firstRows + 2);
    expect(sentSync(catchingUp)).toBe(firstSync);

    const caughtUp = await waitForLedger(ledgerPage, (state) => (sentSync(state) ?? 0) > firstSync, 90_000);
    expect(sentSync(caughtUp) ?? 0).toBeGreaterThanOrEqual(backAt + PAGE_RESYNC_MS - 1_000);
    expect(caughtUp.tables.adapterHealth.find((report) => report.adapterId === 'gmail.sent')).toMatchObject({
      status: 'OK',
    });
  } finally {
    await extension.close();
    await server.close();
  }
});
