/**
 * The options page's exports on the real build (sprint_4 4.5; Sprint 2 close, MANUAL.md live smoke step 8). The
 * ledger of the Sprint 2 and 3 end-to-end flows (the Gmail Sent list, a Calendar week, the §2 demo pasted in the side
 * panel) is saved by "Export ledger" as one JSON file, which the page builds from its own paged reads: its bytes are
 * the service worker's single-message export's, the export instant aside. "Export receipts" saves one CSV line per
 * receipt. Each file is named for the export's own date and the page says which it saved. No console error.
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { RECEIPT_CSV_COLUMNS } from '../../src/ledger/export-csv';
import { DEMO_LOG, demoSentPage } from './support/demo';
import { pasteActivity } from './support/paste';
import { type VendorSession, withVendorSession } from './support/session';
import {
  fixtureUrl,
  openVendorPage,
  readLedger,
  requestUrl,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

/** The export instant's line: the one line two exports of one ledger may differ in. */
const EXPORTED_AT_LINE = /^ {2}"exportedAt": "[^"]*",$/mu;
const withoutInstant = (json: string): string => json.replace(EXPORTED_AT_LINE, '  "exportedAt": "",');

/** The service worker's single-message export, as the page saved it before 4.5: parsed, then written with indent 2. */
const singleMessage = async (page: Page): Promise<string> =>
  `${JSON.stringify(await readLedger(page), null, 2)}\n`;

/** Clicks `button` on the options page and returns the file the browser was handed: its name and its text. */
async function download(page: Page, button: string): Promise<{ name: string; text: string }> {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await downloaded;
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

/** The Sprint 2 and 3 flows: the Gmail Sent list and a Calendar week read, then the §2 demo pasted for Muse. */
async function runFlows({ extension, routes, ledgerPage: options }: VendorSession): Promise<void> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  routes.set(requestUrl(fixtureUrl(sent)), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
  const gmail = await extension.context.newPage();
  await gmail.goto(fixtureUrl(sent));
  const week = vendorFixture('gcal', 'synthetic-gcal-week-before.html');
  const calendar = await openVendorPage(extension.context, routes, week);
  await waitForLedger(
    options,
    (ledger) =>
      ledger.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent') &&
      ledger.tables.calendarSnapshots.length > 0,
  );
  const panel = await extension.openExtensionPage('sidepanel.html');
  expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
  // No reader is left to write while the files are compared.
  await gmail.close();
  await calendar.close();
}

/**
 * Saves the ledger file and compares it with the worker's export. A batch the grace alarm runs between two reads
 * changes the ledger, so the comparison counts only when the worker's export read the same before and after the file.
 */
async function expectLedgerFile(options: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await singleMessage(options);
    const file = await download(options, 'Export ledger');
    const after = await singleMessage(options);
    if (withoutInstant(before) !== withoutInstant(after)) continue;
    const exportedAt = /"exportedAt": "([^"]*)"/u.exec(file.text)?.[1] ?? '';
    expect(file.name).toBe(`attest-ledger-${exportedAt.slice(0, 10)}.json`);
    expect(withoutInstant(file.text)).toBe(withoutInstant(after));
    await expect(options.locator('#export').getByRole('status')).toHaveText(`Exported ${file.name}.`);
    return;
  }
  throw new Error('the ledger changed under every comparison');
}

test('Export ledger saves the bytes of the worker export, and Export receipts one CSV line each', async () => {
  test.setTimeout(3 * 60_000);
  await withVendorSession(async (session) => {
    const options = session.ledgerPage;
    const errors: string[] = [];
    options.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await runFlows(session);
    await expectLedgerFile(options);

    const ledger = await readLedger(options);
    expect(ledger.tables.receipts.length).toBeGreaterThan(0);
    const csv = await download(options, 'Export receipts');
    expect(csv.name).toMatch(/^attest-receipts-\d{4}-\d{2}-\d{2}\.csv$/u);
    const [header, ...lines] = csv.text.split('\r\n');
    expect(header).toBe(RECEIPT_CSV_COLUMNS.join(','));
    expect(lines.at(-1)).toBe('');
    expect(
      lines
        .slice(0, -1)
        .map((line) => line.split(',')[0])
        .sort(),
    ).toEqual(ledger.tables.receipts.map(({ id }) => id).sort());
    await expect(options.locator('#export').getByRole('status')).toHaveText(`Exported ${csv.name}.`);
    expect(errors).toEqual([]);
  });
});
