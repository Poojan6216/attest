/**
 * The options page's settings on the built extension (sprint_4 4.5 done-when). The page readers' content scripts are
 * registered at runtime, each on exactly its hosts: turning Google Calendar off removes its registration
 * (`chrome.scripting.unregisterContentScripts`), so a Calendar page opened then stores nothing while Gmail, still on, is
 * read; turning it on registers it again and the page is read. The choice is in the ledger (security review SEC-3).
 * The retention window is saved in the ledger. Delete all data, asked twice, leaves the ledger and
 * `chrome.storage.local` empty but for the one choice it keeps: a reader the person turned off stays off (SEC-6).
 */
import { readFileSync } from 'node:fs';

import { expect, type Page, test, type Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { DEMO_LOG, demoSentPage } from './support/demo';
import { pasteActivity } from './support/paste';
import { withVendorSession } from './support/session';
import {
  fixtureUrl,
  openVendorPage,
  readLedger,
  requestUrl,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

declare const chrome: WxtBrowser;

/** The worker's content script registrations: id, hosts, script and when it runs, by id. */
async function registrations(worker: Worker): Promise<unknown[]> {
  const scripts = await worker.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((script) => ({
      id: script.id,
      matches: script.matches,
      js: script.js,
      runAt: script.runAt,
    })),
  );
  return scripts.sort((a, b) => (a.id < b.id ? -1 : 1));
}

const ids = async (worker: Worker): Promise<string[]> =>
  (await registrations(worker)).map((script) => (script as { id: string }).id);

/** Everything `chrome.storage.local` holds. */
const storedLocally = (worker: Worker): Promise<Record<string, unknown>> =>
  worker.evaluate(() => chrome.storage.local.get(null));

const calendarRead = (ledger: Awaited<ReturnType<typeof readLedger>>): boolean =>
  ledger.tables.calendarSnapshots.length > 0 ||
  ledger.tables.adapterHealth.some(({ adapterId }) => adapterId === 'gcal.event');

async function turn(options: Page, name: string): Promise<void> {
  await options.getByRole('button', { name }).click();
}

test('turning a reader off unregisters it and nothing of its pages is stored; on again reads them', async () => {
  test.setTimeout(3 * 60_000);
  await withVendorSession(async ({ extension, routes, ledgerPage: options }) => {
    const worker = await extension.serviceWorker();
    expect(await registrations(worker)).toEqual([
      {
        id: 'gcal',
        matches: ['https://calendar.google.com/*'],
        js: ['content-scripts/gcal.js'],
        runAt: 'document_idle',
      },
      {
        id: 'gmail',
        matches: ['https://mail.google.com/*'],
        js: ['content-scripts/gmail.js'],
        runAt: 'document_idle',
      },
    ]);
    await turn(options, 'Turn off Google Calendar');
    await expect.poll(() => ids(worker)).toEqual(['gmail']);
    // The choice is in the ledger, where no script on a vendor page can write it (security review SEC-3).
    expect((await readLedger(options)).tables.meta).toContainEqual({ key: 'readerOff.gcal', value: true });
    expect(await storedLocally(worker)).not.toHaveProperty('attest.readersOff');
    await expect(options.getByRole('button', { name: 'Turn on Google Calendar' })).toBeVisible();

    const week = vendorFixture('gcal', 'synthetic-gcal-week-before.html');
    const calendar = await openVendorPage(extension.context, routes, week);
    // Gmail, still on, is read meanwhile: by then a Calendar page that ran its reader would have reported.
    const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
    routes.set(requestUrl(fixtureUrl(sent)), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
    const gmail = await extension.context.newPage();
    await gmail.goto(fixtureUrl(sent));
    await waitForLedger(options, (ledger) =>
      ledger.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
    );
    await calendar.waitForTimeout(3_000);
    expect(calendarRead(await readLedger(options))).toBe(false);

    await turn(options, 'Turn on Google Calendar');
    await expect.poll(() => ids(worker)).toEqual(['gcal', 'gmail']);
    await calendar.reload();
    await waitForLedger(options, calendarRead);
  });
});

test('the retention window is saved, and Delete all data leaves the ledger and storage empty but for a reader kept off', async () => {
  test.setTimeout(3 * 60_000);
  await withVendorSession(async ({ extension, ledgerPage: options }) => {
    const worker = await extension.serviceWorker();
    const panel = await extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
    await panel.close();

    await options.getByRole('radio', { name: '30 days' }).check();
    await options.getByRole('button', { name: 'Save retention' }).click();
    await expect(options.locator('#privacy').getByRole('status').first()).toHaveText(
      'Saved. Attest keeps 30 days of history.',
    );
    expect((await readLedger(options)).tables.meta).toContainEqual({ key: 'retentionDays', value: 30 });
    await turn(options, 'Turn off Gmail');
    await expect.poll(() => ids(worker)).toEqual(['gcal']);
    const before = await readLedger(options);
    expect(before.tables.claims).toHaveLength(2);

    await options.getByRole('button', { name: 'Delete all data' }).click();
    await options.getByRole('checkbox', { name: 'I understand that everything is deleted for good' }).check();
    await options.getByRole('button', { name: 'Delete everything' }).click();
    await expect(options.locator('#danger-zone').getByText('Deleted. Attest keeps nothing')).toBeVisible();

    const after = await readLedger(options);
    // A grading batch the alarm runs on the new ledger records only its instant; nothing else comes back.
    const { meta, ...tables } = after.tables;
    for (const [name, rows] of Object.entries(tables)) expect(rows, name).toEqual([]);
    // The one thing kept is a choice, never data: the reader the person turned off stays off (security review SEC-6).
    expect(
      meta.map(({ key }) => key).filter((key) => !['lastEvaluatedAt', 'gradedWrites'].includes(key)),
    ).toEqual(['readerOff.gmail']);
    expect(after.receiptInputs).toEqual({});
    expect(after.policies).toEqual({});
    expect(await storedLocally(worker)).toEqual({});
    await expect.poll(() => ids(worker)).toEqual(['gcal']);
    await expect(options.getByRole('button', { name: 'Turn on Gmail' })).toBeVisible();
  });
});
