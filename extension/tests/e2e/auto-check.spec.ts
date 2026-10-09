/**
 * Auto-check Gmail on the built extension (sprint_4 4.9 done-when: "flag off → no tab ever opens (E2E); flag on →
 * exactly one pinned visible tab per window"; "`tabs` permission is NOT required for `chrome.tabs.create` with a URL;
 * verify and record"). Muse's log says it sent an email two minutes ago, and no Gmail tab is open, so its receipt is
 * PENDING with no Gmail coverage. The service worker's clock is moved past the 15 minutes such a claim waits, and the
 * grace alarm fired: with Check Gmail for me off, no tab opens, then or later. Turned on in the options page, the next
 * alarm opens exactly one tab, pinned and active, on the Gmail Sent folder (served here by the demo's Sent page, which
 * the Gmail reader then reads), and the popup says why; another alarm in the same 30-minute window opens none. The
 * built manifest asks for no `tabs` permission. No console error on the options page or the popup.
 */
import { readFileSync } from 'node:fs';

import { type BrowserContext, expect, type Page, test, type Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { ALARM_NAMES, AUTO_CHECK_URL, GRADE_ALARM_PERIOD_MINUTES } from '../../src/config';
import { demoSentPage } from './support/demo';
import { datedClock, pasteActivity } from './support/paste';
import { type VendorSession, withVendorSession } from './support/session';
import {
  FIXTURE_TIME_ZONE,
  readLedger,
  requestUrl,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

declare const chrome: WxtBrowser;

const MINUTE = 60_000;

/**
 * Moves the worker's clock `minutes` past the real one (the batches and the auto-check read `Date.now`) and fires the
 * grace alarm at once, keeping its period; resolves the worker's now.
 */
async function graceAlarmAt(worker: Worker, minutes: number): Promise<number> {
  return worker.evaluate(
    ({ ahead, name, period }) => {
      const kept: unknown = Reflect.get(globalThis, 'attestRealNow');
      const real = typeof kept === 'function' ? (kept as () => number) : Date.now.bind(Date);
      Reflect.set(globalThis, 'attestRealNow', real);
      Reflect.set(Date, 'now', () => real() + ahead * 60_000);
      void chrome.alarms.create(name, { when: real() + 300, periodInMinutes: period });
      return real() + ahead * 60_000;
    },
    { ahead: minutes, name: ALARM_NAMES.GRADE, period: GRADE_ALARM_PERIOD_MINUTES },
  );
}

/** Waits until a grading batch at or after `atMs` (the worker's clock) is recorded, and the auto-check after it. */
async function batchDone(ledgerPage: Page, atMs: number): Promise<void> {
  await waitForLedger(ledgerPage, (ledger) =>
    ledger.tables.meta.some(
      ({ key, value }) => key === 'lastEvaluatedAt' && typeof value === 'string' && Date.parse(value) >= atMs,
    ),
  );
  // The auto-check runs right after the batch, in the same alarm: one storage read when off, one ledger read when on.
  await ledgerPage.waitForTimeout(3_000);
}

interface GmailTab {
  readonly url: string;
  readonly pinned: boolean;
  readonly active: boolean;
}

/** The Gmail tabs open, read by the worker: its host permission shows their address, with no `tabs` permission. */
async function gmailTabs(worker: Worker): Promise<GmailTab[]> {
  return worker.evaluate(async () =>
    (await chrome.tabs.query({ url: 'https://mail.google.com/*' })).map((tab) => ({
      url: tab.url ?? tab.pendingUrl ?? '',
      pinned: tab.pinned,
      active: tab.active,
    })),
  );
}

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
  return states;
}

/** Turns Check Gmail for me on in the options page; resolves the page's console errors from then on. */
async function turnOn(session: VendorSession): Promise<string[]> {
  const options = await session.extension.openExtensionPage('options.html');
  const errors = errorsOf(options);
  await options.getByRole('button', { name: 'Turn on checking Gmail' }).click();
  await expect(options.getByRole('group', { name: 'Check Gmail for me' }).getByRole('status')).toHaveText(
    'Checking Gmail for you is on.',
  );
  return errors;
}

/**
 * The tab was created before the route guard could attach to it, so its first load fails at the session's dead
 * proxy, and its page shows Chrome's error page (or still the Gmail address, while it fails); loaded again under the
 * guard, it shows the demo's Sent page, which the Gmail reader reads.
 */
async function loadUnderGuard(session: VendorSession): Promise<void> {
  const tabPages = (): Page[] =>
    session.extension.context
      .pages()
      .filter(
        (page) =>
          page.url().startsWith('chrome-error://') || page.url().startsWith('https://mail.google.com/'),
      );
  await expect.poll(() => tabPages().length, { timeout: 30_000 }).toBe(1);
  await tabPages()[0]?.goto(AUTO_CHECK_URL);
  await waitForLedger(session.ledgerPage, (ledger) =>
    ledger.tables.coverage.some(({ source }) => source === 'gmail.sent'),
  );
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
  return errors;
}

test('off, no tab ever opens; on, exactly one pinned, visible Gmail Sent tab a window, and the popup says why', async () => {
  test.setTimeout(4 * 60_000);
  await withVendorSession(async (session) => {
    const { context } = session.extension;
    const worker = await session.extension.serviceWorker();
    const permissions = await worker.evaluate(() => chrome.runtime.getManifest().permissions ?? []);
    expect(permissions).not.toContain('tabs');
    const states = await pendingEmailClaim(session);

    // Off: a claim due and unseen opens nothing, at its due time or later.
    for (const minutes of [16, 40]) {
      await batchDone(session.ledgerPage, await graceAlarmAt(worker, minutes));
      expect(await gmailTabs(worker)).toEqual([]);
      expect(gmailPages(context)).toEqual([]);
    }
    expect(await autoCheckAt(session.ledgerPage)).toBeUndefined();

    // On: the next alarm opens exactly one tab, pinned and active, on the Sent folder.
    const optionErrors = await turnOn(session);
    const openedAt = await graceAlarmAt(worker, 50);
    await expect
      .poll(() => gmailTabs(worker), { timeout: 60_000 })
      .toEqual([{ url: AUTO_CHECK_URL, pinned: true, active: true }]);
    expect(await states()).toEqual(['PENDING']);
    const at = await autoCheckAt(session.ledgerPage);
    expect(Date.parse(at ?? '')).toBeGreaterThanOrEqual(openedAt);
    await loadUnderGuard(session);

    // The same window: another alarm opens nothing more.
    await batchDone(session.ledgerPage, await graceAlarmAt(worker, 60));
    expect(await gmailTabs(worker)).toHaveLength(1);
    expect(gmailPages(context)).toHaveLength(1);
    expect(await autoCheckAt(session.ledgerPage)).toBe(at);

    expect(await popupSaysWhy(session, openedAt + 5 * MINUTE)).toEqual([]);
    expect(optionErrors).toEqual([]);
  });
});
