/**
 * The degraded banner on the built extension (sprint_4 close, QA review GAP 2; Hard Rule 6, ux_engineer rule 3): a
 * Gmail Sent list whose time cells are gone makes the Gmail Sent reader DEGRADED (`selector.missing.time`), and the
 * popup and the side panel each say so in an alert, "Degraded: Gmail Sent reader <version>", with a link to a new
 * GitHub issue that names the reader, its version and the Chrome major version, and nothing of the page. A clean pass
 * of the Sent list takes the banner away from both while they stay open. No console error on either.
 */
import { expect, type Page, test } from '@playwright/test';

import { ISSUES_URL } from '../../src/config';
import type { LedgerExport } from '../../src/ledger/export';
import { type VendorSession, withVendorSession } from './support/session';
import {
  brokenSentList,
  openVendorPage,
  requestUrl,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

const sentHealth = (ledger: LedgerExport) =>
  ledger.tables.adapterHealth.find((report) => report.adapterId === 'gmail.sent');

interface Opened {
  readonly page: Page;
  readonly errors: string[];
}

/** Opens an extension page in a tab, recording its console errors and uncaught exceptions from the start. */
async function openRecorded(session: VendorSession, file: string): Promise<Opened> {
  const page = await session.extension.context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${session.extension.extensionId}/${file}`);
  return { page, errors };
}

const bannerOf = (page: Page) => page.getByRole('alert').filter({ hasText: 'Degraded:' });

/** The banner names the reader and its version; its link names those and Chrome's major version, and nothing else. */
async function expectBanner(page: Page, version: string): Promise<void> {
  const banner = bannerOf(page);
  await expect(banner).toContainText(
    `Degraded: Gmail Sent reader ${version} is not reading its page as expected.`,
  );
  const href = (await banner.getByRole('link', { name: /Report on GitHub/u }).getAttribute('href')) ?? '';
  const url = new URL(href);
  expect(`${url.origin}${url.pathname}`).toBe(ISSUES_URL);
  expect([...url.searchParams.keys()]).toEqual(['title', 'body']);
  expect(url.searchParams.get('title')).toBe(`Degraded: gmail.sent ${version}`);
  const major = /Chrome\/(\d+)/u.exec(await page.evaluate(() => navigator.userAgent))?.[1] ?? 'none';
  expect(major).toMatch(/^\d+$/u);
  expect(url.searchParams.get('body')).toBe(`Adapter: gmail.sent\nVersion: ${version}\nChrome: ${major}\n`);
  // Nothing of the page: no address, no host, no fixture name.
  expect(href).not.toMatch(/@|mail\.google|fixture|sent-page/u);
}

test('a broken Sent list shows the degraded banner on the popup and the side panel; a clean pass takes it away', async () => {
  test.setTimeout(3 * 60_000);
  await withVendorSession(async (session) => {
    const broken = brokenSentList();
    session.routes.set(requestUrl(broken.url), broken.html);
    const gmail = await session.extension.context.newPage();
    await gmail.goto(broken.url);
    const degraded = await waitForLedger(
      session.ledgerPage,
      (ledger) => sentHealth(ledger)?.status === 'DEGRADED',
    );
    const health = sentHealth(degraded);
    expect(health?.reasons).toEqual(['selector.missing.time']);
    const version = health?.version ?? '';
    expect(version).not.toBe('');

    const opened = [await openRecorded(session, 'popup.html'), await openRecorded(session, 'sidepanel.html')];
    for (const { page } of opened) await expectBanner(page, version);

    // A clean pass of the same tab: the reader is well again, and both pages, still open, drop the banner.
    await openVendorPage(
      session.extension.context,
      session.routes,
      vendorFixture('gmail', 'synthetic-sent-page-1.html'),
      gmail,
    );
    await waitForLedger(session.ledgerPage, (ledger) => sentHealth(ledger)?.status === 'OK');
    for (const { page } of opened) await expect(bannerOf(page)).toHaveCount(0);
    expect(opened.flatMap(({ errors }) => errors)).toEqual([]);
  });
});
