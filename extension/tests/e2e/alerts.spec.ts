/**
 * Alerts on the built extension (sprint_4 4.6 done-when). The build_spec §2 demo yields exactly two notifications, for
 * its NOT_FOUND and its UNASKED receipts, and none for its VERIFIED one; each is asked of Chrome once, named by its
 * receipt's id. A restarted service worker shows none again: every alert stays settled as it was, and a batch after the
 * restart asks Chrome for nothing. With Muse muted in the options page, the demo yields none. The notifications Chrome
 * is asked for are counted in the service worker itself (`chrome.notifications.create`, wrapped by the test).
 */
import { expect, type Page, test, type Worker } from '@playwright/test';
import type { Browser, WxtBrowser } from 'wxt/browser';

import type { LedgerExport } from '../../src/ledger/export';
import { DEMO_LOG } from './support/demo';
import { openDemoPages, writeAway } from './support/demo-flow';
import { pasteActivity } from './support/paste';
import { type VendorSession, withVendorSession } from './support/session';
import { readLedger, waitForLedger } from './support/vendor-pages';

declare const chrome: WxtBrowser;

/** Counts, in the worker, each notification Attest asks Chrome for, by its id; Chrome is still asked. */
async function countNotifications(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const asked: string[] = [];
    Reflect.set(globalThis, 'attestAsked', asked);
    const create = chrome.notifications.create.bind(chrome.notifications);
    Reflect.set(
      chrome.notifications,
      'create',
      (id: string, options: Browser.notifications.NotificationCreateOptions) => {
        asked.push(id);
        return create(id, options);
      },
    );
  });
}

const asked = (worker: Worker): Promise<string[]> =>
  worker.evaluate(() => [...(Reflect.get(globalThis, 'attestAsked') as string[])]);

const receiptOf = (ledger: LedgerExport, grade: string): string | undefined =>
  ledger.tables.receipts.find((receipt) => receipt.grade === grade)?.id;

/** Opens the demo's pages, stores its time away and pastes Muse's log: three receipts, all FINAL. */
async function runDemo(session: VendorSession): Promise<LedgerExport> {
  await openDemoPages(session);
  await writeAway(session);
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
  return waitForLedger(session.ledgerPage, (ledger) => ledger.tables.alerts.length === 2);
}

async function restartWorker(session: VendorSession): Promise<Worker> {
  const cdp = await session.extension.context.newCDPSession(session.ledgerPage);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  // A message wakes it: it starts again, settling whatever is pending (nothing).
  await readLedger(session.ledgerPage);
  return session.extension.serviceWorker();
}

test('the §2 demo yields exactly two alerts, NOT_FOUND and UNASKED, and a restart shows none again', async () => {
  test.setTimeout(4 * 60_000);
  await withVendorSession(async (session) => {
    await countNotifications(await session.extension.serviceWorker());
    const ledger = await runDemo(session);
    const shown = [receiptOf(ledger, 'NOT_FOUND'), receiptOf(ledger, 'UNASKED')].sort();
    expect(receiptOf(ledger, 'VERIFIED')).toBeDefined();
    expect((await asked(await session.extension.serviceWorker())).sort()).toEqual(shown);
    const settled = ledger.tables.alerts.map(({ receiptId, grade, state, handledAt }) => ({
      receiptId,
      grade,
      state,
      handledAt,
    }));
    expect(settled.map(({ state }) => state)).toEqual(['shown', 'shown']);

    const worker = await restartWorker(session);
    await countNotifications(worker);
    // The restarted worker settled what was pending (nothing). The paste again (its claims known) runs a batch after
    // the restart, which asks Chrome for nothing.
    const panel = await session.extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Attest already had all 2 claims.');
    expect(await asked(worker)).toEqual([]);
    const after = await readLedger(session.ledgerPage);
    expect(
      after.tables.alerts.map(({ receiptId, grade, state, handledAt }) => ({
        receiptId,
        grade,
        state,
        handledAt,
      })),
    ).toEqual(settled);
  });
});

async function muteMuse(options: Page): Promise<void> {
  const muse = options.getByRole('region', { name: 'Muse' });
  await muse.getByLabel('Mute alerts for Muse').check();
  await muse.getByRole('button', { name: 'Save Muse’s grant' }).click();
  await expect(muse.getByRole('status')).toHaveText(
    'Saved. It applies to this agent’s open receipts now, and never changes a final one.',
  );
}

test('with Muse muted, the §2 demo yields no alert', async () => {
  test.setTimeout(4 * 60_000);
  await withVendorSession(async (session) => {
    await muteMuse(session.ledgerPage);
    await countNotifications(await session.extension.serviceWorker());
    const ledger = await runDemo(session);
    expect(await asked(await session.extension.serviceWorker())).toEqual([]);
    expect(ledger.tables.alerts.map(({ state }) => state)).toEqual(['muted', 'muted']);
  });
});
