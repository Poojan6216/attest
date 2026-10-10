/**
 * Red-team strategy 13, encryption at rest (agents/red_team.md; sprint_6 6.3 carried to 6.5: "a wrong passphrase, a
 * passphrase change mid-session, and the ledger copied to another profile, nothing readable"), beside the harness
 * (tests/e2e/redteam-harness.spec.ts) because each case attacks the stored ledger rather than a grade. On the built
 * extension, with two invented Gmail sends stored and encryption turned on:
 *  - the profile copied while the browser is closed, and opened in another: locked; no send readable in IndexedDB;
 *    every wrong passphrase refused, the near misses (a letter's case, a trailing space) among them, and nothing read;
 *    the passphrase itself opens the copy, the one thing encryption at rest does not stop (docs/attacks-that-work.md);
 *  - the passphrase changed while pages are open: they keep reading, every row is sealed again under one new key, and
 *    after a restart of the service worker the old passphrase is refused and the new one opens it.
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  LOCKED_TEXT,
  ledgerAtRest,
  stopServiceWorker,
  turnOnEncryption,
  unlockIn,
  wakeServiceWorker,
} from './support/encryption';
import { launchExtension } from './support/extension';
import { MINUTE_MS, openSent } from './support/priya';
import { startVendorSession, endVendorSession, withVendorSession } from './support/session';
import { FIXTURE_TIME_ZONE, readLedger } from './support/vendor-pages';

/** Invented passphrases only. The first carries an accent, written composed; a decomposed copy is the same one. */
const PASSPHRASE = 'un café invented passphrase';
const SAME_DECOMPOSED = 'un café invented passphrase';
const NEXT = 'another invented passphrase';
const SENT_VALUES = ['priya@company.example', 'lee@company.example', 'Q3 deck', 'Lunch'];
const WRONG = ['Un café invented passphrase', `${PASSPHRASE} `, 'un cafe invented passphrase', NEXT, 'x'];

test('strategy 13: a copy of the profile opens nothing without the passphrase', async () => {
  test.setTimeout(240_000);
  const session = await startVendorSession();
  const copyDir = mkdtempSync(path.join(os.tmpdir(), 'attest-copied-profile-'));
  let copy: Awaited<ReturnType<typeof launchExtension>> | undefined;
  try {
    const { extension, routes, ledgerPage } = session;
    const nowMs = Date.now();
    await openSent(extension, routes, ledgerPage, nowMs, nowMs - 20 * MINUTE_MS);
    await turnOnEncryption(ledgerPage, PASSPHRASE);
    await extension.context.close();
    cpSync(extension.userDataDir, copyDir, { recursive: true });

    copy = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE, userDataDir: copyDir });
    const popup = await copy.openExtensionPage('popup.html');
    await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
    expect(await ledgerAtRest(popup, SENT_VALUES)).toMatchObject({ plain: 0, found: [] });
    for (const wrong of WRONG) {
      await unlockIn(popup, wrong);
      await expect(popup.getByText('That passphrase does not open your records')).toBeVisible();
      await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
    }
    expect(await ledgerAtRest(popup, SENT_VALUES)).toMatchObject({ plain: 0, found: [] });
    // The passphrase itself, typed decomposed, opens the copy: encryption at rest stops a copy without it, not with it.
    await unlockIn(popup, SAME_DECOMPOSED);
    await expect(popup.getByText(LOCKED_TEXT)).toHaveCount(0);
  } finally {
    await copy?.close();
    rmSync(copyDir, { recursive: true, force: true });
    await endVendorSession(session);
  }
});

test('strategy 13: a passphrase changed mid-session leaves every row under the new key, and the old one opens nothing', async () => {
  test.setTimeout(240_000);
  await withVendorSession(async ({ extension, routes, ledgerPage }) => {
    const nowMs = Date.now();
    await openSent(extension, routes, ledgerPage, nowMs, nowMs - 20 * MINUTE_MS);
    await turnOnEncryption(ledgerPage, PASSPHRASE);
    const first = await ledgerAtRest(ledgerPage, SENT_VALUES);
    const popup = await extension.openExtensionPage('popup.html');
    await expect(popup.getByText(LOCKED_TEXT)).toHaveCount(0);

    const section = ledgerPage.locator('#encryption');
    await section.getByLabel('Passphrase in use').first().fill(PASSPHRASE);
    await section.getByLabel('New passphrase').fill(NEXT);
    await section.getByLabel('Type the new one again').fill(NEXT);
    await section.getByRole('button', { name: 'Change passphrase' }).click();
    // Done when every row is sealed under one key, not the first: the job has rewritten them all.
    await expect
      .poll(
        async () => {
          const rest = await ledgerAtRest(ledgerPage, SENT_VALUES);
          return rest.plain === 0 && rest.keyIds.length === 1 && rest.keyIds[0] !== first.keyIds[0];
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect(section.getByText('Your records are sealed, and unlocked in this browser now.')).toBeVisible(
      {
        timeout: 60_000,
      },
    );
    expect(await ledgerAtRest(ledgerPage, SENT_VALUES)).toMatchObject({ plain: 0, found: [] });
    await popup.reload();
    await expect(popup.getByText(LOCKED_TEXT)).toHaveCount(0);
    expect((await readLedger(ledgerPage)).tables.observations.length).toBeGreaterThan(0);

    await stopServiceWorker(extension, ledgerPage);
    await wakeServiceWorker(ledgerPage);
    await popup.reload();
    await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
    await unlockIn(popup, PASSPHRASE);
    await expect(popup.getByText('That passphrase does not open your records')).toBeVisible();
    await unlockIn(popup, NEXT);
    await expect(popup.getByText(LOCKED_TEXT)).toHaveCount(0);
  });
});
