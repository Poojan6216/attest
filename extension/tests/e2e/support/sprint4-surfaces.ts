/**
 * Sprint 4's surfaces, driven in the mandatory network-intercept session (sprint_4 close, QA review GAP 7; Hard Rule
 * 1), as a person would on the shipped build: Check Gmail for me opening its one tab on the §2 demo's Sent page
 * (first, while no Gmail page has been read, so the claim it checks is due), then the demo's alert, a receipt's share
 * with its image, the weekly digest made by its alarm with its page and share, a grant saved, both exports, a reader
 * turned off and on again, and Delete all data (last: it empties the ledger). The session's route guard and NetLog
 * see every request each makes.
 */
import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';

import { AUTO_CHECK_URL } from '../../../src/config';
import { graceAlarmAt, loadUnderGuard, oneSentTab, turnOnAutoCheck } from './auto-check';
import { DEMO_LOG, demoSentPage } from './demo';
import { writeAway } from './demo-flow';
import { makeDigestNow, readShare } from './digest';
import { datedClock, pasteActivity } from './paste';
import type { VendorSession } from './session';
import { FIXTURE_TIME_ZONE, requestUrl, vendorFixture, waitForLedger } from './vendor-pages';

/**
 * Check Gmail for me turned on, an email claim pasted with no Gmail page read, and the grace alarm fired 16 minutes
 * on: Attest opens its one tab, on the demo's Sent page routed at AUTO_CHECK_URL, which the reader then reads (the
 * demo's sends are stored before any other Sent page is read). The worker's clock stays 16 minutes ahead: a batch on
 * the real clock would come before the one that alarm ran, and the ledger refuses a batch out of order. Resolves the
 * tab's page.
 */
export async function checkGmailForMe(session: VendorSession): Promise<Page> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  session.routes.set(requestUrl(AUTO_CHECK_URL), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
  await turnOnAutoCheck(session.ledgerPage);
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  const log = ['Sent an email to sam@example.com', datedClock(2, FIXTURE_TIME_ZONE)].join('\n');
  expect(await pasteActivity(panel, 'Muse', log)).toBe('Imported 1 claim.');
  await panel.close();
  const worker = await session.extension.serviceWorker();
  await graceAlarmAt(worker, 16);
  await oneSentTab(worker);
  return loadUnderGuard(session.extension.context, session.ledgerPage);
}

/**
 * The §2 demo's time away stored and Muse's log pasted, its Sent page read by then: the send Muse never mentioned,
 * made while the person was away, is UNASKED and alerted. Then one receipt is shared, with its image.
 */
async function alertsAndReceiptShare(session: VendorSession): Promise<void> {
  await writeAway(session);
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
  await waitForLedger(session.ledgerPage, (ledger) =>
    ledger.tables.alerts.some(({ grade, state }) => grade === 'UNASKED' && state === 'shown'),
  );
  await panel
    .locator('li[data-receipt]')
    .first()
    .getByRole('button', { name: /^Open details/u })
    .click();
  await panel.getByRole('button', { name: 'Share this receipt' }).click();
  await expect(panel.getByRole('img', { name: 'This receipt as an image' })).toBeVisible();
  await panel.close();
}

/** Clicks an export button and waits until the browser holds the whole file. */
async function exportFile(options: Page, button: string): Promise<void> {
  const downloaded = options.waitForEvent('download');
  await options.getByRole('button', { name: button }).click();
  expect(await (await downloaded).failure()).toBeNull();
}

/** In the options page: a grant saved, both exports, a reader turned off and on again, then Delete all data. */
async function optionsActions(options: Page): Promise<void> {
  const muse = options.getByRole('region', { name: 'Muse' });
  await muse.getByLabel('Mute alerts for Muse').check();
  await muse.getByRole('button', { name: 'Save Muse’s grant' }).click();
  await expect(muse.getByRole('status')).toHaveText(
    'Saved. It applies to this agent’s open receipts now, and never changes a final one.',
  );
  await exportFile(options, 'Export ledger');
  await exportFile(options, 'Export receipts');
  await options.getByRole('button', { name: 'Turn off Google Calendar' }).click();
  await options.getByRole('button', { name: 'Turn on Google Calendar' }).click();
  await expect(options.getByRole('button', { name: 'Turn off Google Calendar' })).toBeVisible();
  await options.getByRole('button', { name: 'Delete all data' }).click();
  await options.getByRole('checkbox', { name: 'I understand that everything is deleted for good' }).check();
  await options.getByRole('button', { name: 'Delete everything' }).click();
  await expect(options.locator('#danger-zone').getByText('Deleted. Attest keeps nothing')).toBeVisible();
}

/**
 * Every Sprint 4 surface after Check Gmail for me, in order; resolves the digest page, which the session keeps and
 * reloads with its other pages.
 */
export async function sprint4Surfaces(session: VendorSession): Promise<Page> {
  await alertsAndReceiptShare(session);
  await makeDigestNow(session.extension, session.ledgerPage);
  const { page: digest } = await readShare(session.extension);
  await optionsActions(session.ledgerPage);
  return digest;
}
