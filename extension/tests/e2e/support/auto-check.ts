/**
 * Driving Check Gmail for me on the built extension (sprint_4 4.9; shared by tests/e2e/auto-check.spec.ts and the
 * mandatory tests/e2e/network-intercept.spec.ts, sprint_4 close QA review GAP 7). The service worker's clock is moved
 * ahead and the grace alarm fired at once; an alarm's check is known done when its upkeep, which runs after it
 * (src/background/alarms.ts `graceUpkeep`), sets the purge alarm the test cleared again (QA review GAP 10: no fixed
 * wait). The tab Attest opens starts loading before the route guard is attached to it, so its first load fails at the
 * dead proxy every launch runs behind (./extension.ts); it is loaded again under the guard.
 */
import { type BrowserContext, expect, type Page, type Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { ALARM_NAMES, AUTO_CHECK_URL, GRADE_ALARM_PERIOD_MINUTES } from '../../../src/config';
import { waitForLedger } from './vendor-pages';

declare const chrome: WxtBrowser;

/**
 * Moves the worker's clock `minutes` past the real one (the batches and the auto-check read `Date.now`), clears the
 * purge alarm and fires the grace alarm at once, keeping its period; resolves the worker's now.
 */
export async function graceAlarmAt(worker: Worker, minutes: number): Promise<number> {
  return worker.evaluate(
    async ({ ahead, name, period, purge }) => {
      const kept: unknown = Reflect.get(globalThis, 'attestRealNow');
      const real = typeof kept === 'function' ? (kept as () => number) : Date.now.bind(Date);
      Reflect.set(globalThis, 'attestRealNow', real);
      Reflect.set(Date, 'now', () => real() + ahead * 60_000);
      await chrome.alarms.clear(purge);
      await chrome.alarms.create(name, { when: real() + 300, periodInMinutes: period });
      return real() + ahead * 60_000;
    },
    { ahead: minutes, name: ALARM_NAMES.GRADE, period: GRADE_ALARM_PERIOD_MINUTES, purge: ALARM_NAMES.PURGE },
  );
}

/** Waits until the grace alarm's auto-check has run: its upkeep, which follows it, set the purge alarm again. */
export async function checkDone(worker: Worker): Promise<void> {
  await expect
    .poll(
      () =>
        worker.evaluate(async (purge) => (await chrome.alarms.get(purge)) !== undefined, ALARM_NAMES.PURGE),
      { timeout: 60_000 },
    )
    .toBe(true);
}

export interface GmailTab {
  readonly url: string;
  readonly pinned: boolean;
  readonly active: boolean;
}

/** The Gmail tabs open, read by the worker: its host permission shows their address, with no `tabs` permission. */
export async function gmailTabs(worker: Worker): Promise<GmailTab[]> {
  return worker.evaluate(async () =>
    (await chrome.tabs.query({ url: 'https://mail.google.com/*' })).map((tab) => ({
      url: tab.url ?? tab.pendingUrl ?? '',
      pinned: tab.pinned,
      active: tab.active,
    })),
  );
}

/** Waits until the worker sees exactly the one tab Attest opens: pinned, active, on the Gmail Sent folder. */
export async function oneSentTab(worker: Worker): Promise<void> {
  await expect
    .poll(() => gmailTabs(worker), { timeout: 60_000 })
    .toEqual([{ url: AUTO_CHECK_URL, pinned: true, active: true }]);
}

/** Turns Check Gmail for me on in an options page. */
export async function turnOnAutoCheck(options: Page): Promise<void> {
  await options.getByRole('button', { name: 'Turn on checking Gmail' }).click();
  await expect(options.getByRole('group', { name: 'Check Gmail for me' }).getByRole('status')).toHaveText(
    'Checking Gmail for you is on.',
  );
}

/**
 * Loads the one tab Attest opened again, under the guard (its page shows Chrome's error page, or still the Gmail
 * address while its first load fails), and waits until the Gmail reader has read the Sent page routed at
 * AUTO_CHECK_URL; resolves the tab's page.
 */
export async function loadUnderGuard(context: BrowserContext, ledgerPage: Page): Promise<Page> {
  const tabPages = (): Page[] =>
    context
      .pages()
      .filter(
        (page) =>
          page.url().startsWith('chrome-error://') || page.url().startsWith('https://mail.google.com/'),
      );
  await expect.poll(() => tabPages().length, { timeout: 30_000 }).toBe(1);
  const [gmail] = tabPages();
  if (gmail === undefined) throw new Error('no page for the Gmail tab');
  await gmail.goto(AUTO_CHECK_URL);
  await waitForLedger(ledgerPage, (ledger) =>
    ledger.tables.coverage.some(({ source }) => source === 'gmail.sent'),
  );
  return gmail;
}
