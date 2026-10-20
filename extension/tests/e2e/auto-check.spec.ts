/**
 * Auto-check Gmail on the built extension (sprint_4 4.9 done-when: "flag off → no tab ever opens (E2E); flag on →
 * exactly one pinned visible tab per window"; "`tabs` permission is NOT required for `chrome.tabs.create` with a URL;
 * verify and record"). Muse's log says it sent an email two minutes ago, and no Gmail tab is open, so its receipt is
 * PENDING with no Gmail coverage. The service worker's clock is moved past the 15 minutes such a claim waits, and the
 * grace alarm fired: with Check Gmail for me off, no tab opens, then or later. Turned on in the options page, the next
 * alarm opens exactly one tab, pinned and active, on the Gmail Sent folder (served here by the demo's Sent page, which
 * the Gmail reader then reads, with no input event on the tab), and the popup says why; another alarm in the same
 * 30-minute window opens none. The popup's row says the receipt is checking: final from a time within its grace, then
 * waiting for a check after it. Each alarm's check is known done when its upkeep sets the cleared purge alarm again.
 * The built manifest asks for no `tabs` permission. No console error on the options page or the popup.
 */
import { readFileSync } from 'node:fs';

import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { AUTO_CHECK_URL } from '../../src/config';
import {
  checkDone,
  gmailTabs,
  graceAlarmAt,
  loadUnderGuard,
  oneSentTab,
  turnOnAutoCheck,
} from './support/auto-check';
import { demoSentPage } from './support/demo';
import { installRecorder, recorded } from './support/input-recorder';
import { datedClock, pasteActivity } from './support/paste';
import { type VendorSession, withVendorSession } from './support/session';
import { FIXTURE_TIME_ZONE, readLedger, requestUrl, vendorFixture } from './support/vendor-pages';

declare const chrome: WxtBrowser;

const MINUTE = 60_000;

/** The pages of the context on a Gmail address. */
const gmailPages = (context: BrowserContext): Page[] =>
  context.pages().filter((page) => page.url().startsWith('https://mail.google.com/'));

/** The instant the auto-check last opened Gmail, as the ledger keeps it, or undefined. */
async function autoCheckAt(ledgerPage: Page): Promise<string | undefined> {
  const entry = (await readLedger(ledgerPage)).tables.meta.find(({ key }) => key === 'autoCheckAt');
  return typeof entry?.value === 'string' ? entry.value : undefined;
}

/** Records the console errors and uncaught exceptions of `page` from now on. */
function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Muse's log says it sent an email two minutes ago; no Gmail tab is open, so its receipt is PENDING, unseen. */
async function pendingEmailClaim(session: VendorSession): Promise<() => Promise<string[]>> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  session.routes.set(requestUrl(AUTO_CHECK_URL), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  const log = ['Sent an email to sam@example.com', datedClock(2, FIXTURE_TIME_ZONE)].join('\n');
  expect(await pasteActivity(panel, 'Muse', log)).toBe('Imported 1 claim.');
  const states = async () => (await readLedger(session.ledgerPage)).tables.receipts.map((r) => r.state);
  expect(await states()).toEqual(['PENDING']);
  // Within its grace, the popup's row says from when the receipt is final (QA review GAP 11).
  const popup = await session.extension.openExtensionPage('popup.html');
  await expect(popup.locator('li[data-receipt]').first()).toContainText('Checking: final from');
  await popup.close();
  return states;
}

/** Turns Check Gmail for me on in the options page; resolves the page's console errors from then on. */
async function turnOn(session: VendorSession): Promise<string[]> {
  const options = await session.extension.openExtensionPage('options.html');
  const errors = errorsOf(options);
  await turnOnAutoCheck(options);
  return errors;
}

/** Opens the popup on the worker's clock (`nowMs`), checks it says why the tab opened; resolves its console errors. */
async function popupSaysWhy(session: VendorSession, nowMs: number): Promise<string[]> {
  const popup = await session.extension.context.newPage();
  const errors = errorsOf(popup);
  await popup.clock.setFixedTime(new Date(nowMs));
  await popup.goto(`chrome-extension://${session.extension.extensionId}/popup.html`);
  await expect(popup.getByRole('status').filter({ hasText: 'Gmail Sent folder' })).toContainText(
    'Attest opened your Gmail Sent folder in a pinned tab, to check an email Muse says it sent',
  );
  // Past its grace, with no Gmail check after it yet, the row says the receipt waits for one (QA review GAP 11).
  await expect(popup.locator('li[data-receipt]').first()).toContainText(
    'Checking: waiting for a check after',
  );
  return errors;
}

test('off, no tab ever opens; on, exactly one pinned, visible Gmail Sent tab a window, and the popup says why', async () => {
  test.setTimeout(4 * 60_000);
  await withVendorSession(async (session) => {
    const { context } = session.extension;
    const worker = await session.extension.serviceWorker();
    await installRecorder(context);
    const permissions = await worker.evaluate(() => chrome.runtime.getManifest().permissions ?? []);
    expect(permissions).not.toContain('tabs');
    const states = await pendingEmailClaim(session);

    // Off: a claim due and unseen opens nothing, at its due time or later.
    for (const minutes of [16, 40]) {
      await graceAlarmAt(worker, minutes);
      await checkDone(worker);
      expect(await gmailTabs(worker)).toEqual([]);
      expect(gmailPages(context)).toEqual([]);
    }
    expect(await autoCheckAt(session.ledgerPage)).toBeUndefined();

    // On: the next alarm opens exactly one tab, pinned and active, on the Sent folder.
    const optionErrors = await turnOn(session);
    const openedAt = await graceAlarmAt(worker, 50);
    await oneSentTab(worker);
    expect(await states()).toEqual(['PENDING']);
    const at = await autoCheckAt(session.ledgerPage);
    expect(Date.parse(at ?? '')).toBeGreaterThanOrEqual(openedAt);
    // The reader read the tab Attest opened, and did nothing on it (Hard Rule 3; QA review GAP 10).
    expect(await recorded(await loadUnderGuard(context, session.ledgerPage))).toEqual([]);

    // The same window: another alarm opens nothing more.
    await graceAlarmAt(worker, 60);
    await checkDone(worker);
    expect(await gmailTabs(worker)).toHaveLength(1);
    expect(gmailPages(context)).toHaveLength(1);
    expect(await autoCheckAt(session.ledgerPage)).toBe(at);

    expect(await popupSaysWhy(session, openedAt + 5 * MINUTE)).toEqual([]);
    expect(optionErrors).toEqual([]);
  });
});
