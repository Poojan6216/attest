/**
 * Encryption at rest on the built extension (sprint_6 6.5 Done when: "round-trip tests; wrong passphrase yields no
 * plaintext (test reads IndexedDB directly); service-worker restart requires re-unlock"; Gate: "encryption round-trips
 * and fails closed"). Gmail's Sent head stores two invented sends; then, from the options page's Encryption:
 *  - turned on, every row of the sealed tables is sealed under one key, none of the sends' addresses or subjects is
 *    readable in IndexedDB, and the ledger reads back exactly as before;
 *  - the service worker stopped and started again (a message wakes it), the popup asks for the passphrase; a wrong one
 *    is refused and nothing becomes readable; the right one shows the ledger again;
 *  - Lock now locks every page at once;
 *  - the browser closed and opened again on the same profile, the ledger is locked until the passphrase is typed.
 */
import { test, expect } from '@playwright/test';

import {
  cryptoKeysAtRest,
  LOCKED_TEXT,
  ledgerAtRest,
  stopServiceWorker,
  turnOnEncryption,
  unlockIn,
  wakeServiceWorker,
} from './support/encryption';
import { launchExtension } from './support/extension';
import { MINUTE_MS, openSent } from './support/priya';
import { withVendorSession } from './support/session';
import {
  FIXTURE_TIME_ZONE,
  openVendorPage,
  readLedger,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

/** An invented passphrase; no test uses a real one. */
const PASSPHRASE = 'an invented passphrase';
/** The invented sends openSent stores: addresses and subjects that must never be readable at rest. */
const SENT_VALUES = ['priya@company.example', 'lee@company.example', 'Q3 deck', 'Lunch'];

test('turned on, the ledger is sealed at rest and reads back whole; a restart of the service worker locks it', async () => {
  test.setTimeout(180_000);
  await withVendorSession(async ({ extension, routes, ledgerPage }) => {
    const nowMs = Date.now();
    await openSent(extension, routes, ledgerPage, nowMs, nowMs - 20 * MINUTE_MS);
    // A Calendar week too, so the one sealed table keyed by an array is sealed and read back (tech review TECH-5);
    // its tab closed once read, so nothing more is written while the two reads are compared.
    const week = await openVendorPage(
      extension.context,
      routes,
      vendorFixture('gcal', 'synthetic-gcal-week-before.html'),
    );
    await waitForLedger(ledgerPage, (ledger) => ledger.tables.calendarSnapshots.length > 0);
    await week.close();
    const before = await readLedger(ledgerPage);
    // The control: before encryption, the sends are readable in IndexedDB.
    expect((await ledgerAtRest(ledgerPage, SENT_VALUES)).found).toEqual(SENT_VALUES);

    await turnOnEncryption(ledgerPage, PASSPHRASE);
    const rest = await ledgerAtRest(ledgerPage, SENT_VALUES);
    expect(rest).toMatchObject({ plain: 0, found: [] });
    expect(rest.sealed).toBeGreaterThan(0);
    expect(rest.keyIds).toHaveLength(1);
    // Read back whole: every table as before, `meta` too. The encryption state `meta` now holds is left out of the
    // export (Sprint 6 close, security review SEC-4), so it is read from IndexedDB itself.
    expect((await readLedger(ledgerPage)).tables).toEqual(before.tables);
    expect(await cryptoKeysAtRest(ledgerPage)).toEqual(
      expect.arrayContaining(['crypto.sealing', 'crypto.keyId', 'crypto.salt', 'crypto.check']),
    );

    await stopServiceWorker(extension, ledgerPage);
    await wakeServiceWorker(ledgerPage);
    const popup = await extension.openExtensionPage('popup.html');
    await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
    await unlockIn(popup, 'not the passphrase at all');
    await expect(popup.getByText('That passphrase does not open your records')).toBeVisible();
    await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
    expect(await ledgerAtRest(popup, SENT_VALUES)).toMatchObject({ plain: 0, found: [] });
    await unlockIn(popup, PASSPHRASE);
    await expect(popup.getByText(LOCKED_TEXT)).toHaveCount(0);
    expect((await readLedger(ledgerPage)).tables.observations).toEqual(before.tables.observations);

    await ledgerPage.locator('#encryption').getByRole('button', { name: 'Lock now' }).click();
    await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
  });
});

test('the browser closed and opened again on the same profile, the ledger is locked until the passphrase', async () => {
  test.setTimeout(180_000);
  const first = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  const userDataDir = first.userDataDir;
  let reopened: Awaited<ReturnType<typeof launchExtension>> | undefined;
  try {
    const options = await first.openExtensionPage('options.html');
    await turnOnEncryption(options, PASSPHRASE);
    // Closed without removing the profile: the next launch reuses it.
    await first.context.close();
    reopened = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE, userDataDir });
    const popup = await reopened.openExtensionPage('popup.html');
    await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
    await unlockIn(popup, PASSPHRASE);
    await expect(popup.getByText(LOCKED_TEXT)).toHaveCount(0);
  } finally {
    await reopened?.close();
    await first.close().catch(() => undefined);
  }
});
