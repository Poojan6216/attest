/**
 * The options page's "Export ledger" on the real build (Sprint 2 close; MANUAL.md, live smoke step 8). The real Gmail
 * Sent observer reads a labelled Sent list into the ledger; the button then saves one JSON file through the browser.
 * The file is the service worker's whole export (the ledger's export format), it holds those rows, it is named for
 * the export's own date, and the page says which file it saved. No dialog, no console error.
 */
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { LedgerExport } from '../../src/ledger/export';
import { startFixtureServer } from '../tools/serve-fixtures';
import { launchExtension } from './support/extension';
import { installRouteGuard } from './support/network-guard';
import { installedId, openOptions } from './support/options-page';
import {
  expectedObservation,
  FIXTURE_TIME_ZONE,
  openVendorPage,
  readLedger,
  type VendorRoutes,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

const hashes = (ledger: LedgerExport): string[] =>
  ledger.tables.observations.map((observation) => observation.contentHash).sort();

test('Export ledger saves the whole ledger as one JSON file and says which', async () => {
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    const routes: VendorRoutes = new Map();
    await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
    await installedId(extension);
    const { page, errors } = await openOptions(extension);
    const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
    const rows = sent.observations.map((fact) => expectedObservation(sent, fact).contentHash);
    await openVendorPage(extension.context, routes, sent);
    await waitForLedger(page, (ledger) => rows.every((row) => hashes(ledger).includes(row)));

    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export ledger' }).click();
    const download = await downloaded;
    const file = LedgerExport.parse(JSON.parse(await readFile(await download.path(), 'utf8')));

    expect(download.suggestedFilename()).toBe(`attest-ledger-${file.exportedAt.slice(0, 10)}.json`);
    expect(hashes(file)).toEqual(expect.arrayContaining(rows));
    expect(hashes(file)).toEqual(hashes(await readLedger(page)));
    await expect(page.locator('#export').getByRole('status')).toHaveText(
      `Exported ${download.suggestedFilename()}.`,
    );
    expect(errors).toEqual([]);
  } finally {
    await extension.close();
    await server.close();
  }
});
