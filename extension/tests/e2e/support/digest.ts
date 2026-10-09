/**
 * The weekly digest on the built extension, now (sprint_4 4.7 done-when: "alarm fires in E2E (clock advanced)"). The
 * service worker's clock is moved to the next Monday at 09:30 and the digest alarm is set to fire at once, so the
 * digest it makes is of the week the test ran in; the clock comes back when that digest is in the ledger. Then the
 * digest page is opened, and its share read as it would be copied.
 */
import type { Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import type { LedgerExport } from '../../../src/ledger/export';
import type { LaunchedExtension } from './extension';
import { waitForLedger } from './vendor-pages';

declare const chrome: WxtBrowser;

/** Moves the worker's clock to the next Monday 09:30 and fires the digest alarm; returns the week it will make. */
async function fireDigestAlarm(worker: Worker): Promise<string> {
  return worker.evaluate(() => {
    const real = Date.now.bind(Date);
    const monday = new Date(real());
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    monday.setHours(9, 30, 0, 0);
    const shift = monday.getTime() - real();
    Reflect.set(globalThis, 'attestRealNow', real);
    Reflect.set(Date, 'now', () => real() + shift);
    void chrome.alarms.create('attest.digest', { when: real() + 300 });
    const week = new Date(monday);
    week.setDate(week.getDate() - 7);
    const two = (n: number) => String(n).padStart(2, '0');
    return `${String(week.getFullYear())}-${two(week.getMonth() + 1)}-${two(week.getDate())}`;
  });
}

/** Makes the digest of this week through its alarm, and returns the ledger holding it. */
export async function makeDigestNow(extension: LaunchedExtension, ledgerPage: Page): Promise<LedgerExport> {
  const worker = await extension.serviceWorker();
  const week = await fireDigestAlarm(worker);
  const ledger = await waitForLedger(ledgerPage, (state) =>
    state.tables.digests.some((d) => d.week === week),
  );
  await worker.evaluate(() => {
    Reflect.set(Date, 'now', Reflect.get(globalThis, 'attestRealNow'));
  });
  return ledger;
}

/** Opens the digest page and returns it with the text its share would copy. */
export async function readShare(extension: LaunchedExtension): Promise<{ page: Page; share: string }> {
  const page = await extension.openExtensionPage('digest.html');
  await page.getByRole('button', { name: 'Share this week' }).click();
  const share = (await page.getByLabel('What you would share').textContent()) ?? '';
  return { page, share };
}
