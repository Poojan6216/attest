/**
 * Service-worker lifecycle on the real build (qa_tester priority 7 and rule 6; sprint 0 Gate "loads with
 * zero console errors"). Added by the Sprint 0 QA review.
 *
 *  - Install: the install id exists and the purge alarm is scheduled with its period (background.ts wiring,
 *    which no unit test reaches).
 *  - Every extension page opens with zero console errors or uncaught exceptions.
 *  - Browser restart (same profile): the purge alarm exists again even if Chrome dropped it, and the install
 *    id is unchanged (onStartup / onInstalled wiring in background.ts).
 *  - Restart: Chrome stops idle MV3 workers at any time. After a CDP stop, a bus query must wake the worker
 *    (listeners registered at top level), and the worker must start with no error or warning, keep the
 *    install id and the alarm schedule, and still answer from the same ledger. Playwright keeps one
 *    Worker object across the restart (its DevTools session survives the stop), so the restarted
 *    instance's console is read from that object; CDP reports the running status and uncaught errors.
 *
 * Not covered: console output of the very first start (install). It runs before any test can attach;
 * the install test checks its effects instead.
 *
 *  - Mid-grace (qa_tester rule 6; Sprint 3 QA review GAP 3): a receipt still PENDING when Chrome stops the worker
 *    is FINAL after the next grace alarm, from the ledger alone, and replays exactly.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CDPSession, Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import {
  ALARM_NAMES,
  GRADE_ALARM_PERIOD_MINUTES,
  PURGE_ALARM_PERIOD_MINUTES,
  STORAGE_KEYS,
  TELEMETRY_ALARM_PERIOD_MINUTES,
} from '../../src/config';
import { plantIndexedDbProbe } from './support/channels';
import { launchExtension, type LaunchedExtension } from './support/extension';
import { datedClock, pasteActivity } from './support/paste';
import { replayExport } from './support/replay';
import { withVendorSession } from './support/session';
import { expect, test } from './support/test';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  readLedger,
  requestUrl,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

declare const chrome: WxtBrowser;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXTENSION_PAGES = [
  { page: 'popup.html', ready: 'h1' },
  { page: 'options.html', ready: '#install-id-value' },
  { page: 'sidepanel.html', ready: 'h1' },
] as const;

async function storedInstallId(worker: Worker): Promise<unknown> {
  return worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STORAGE_KEYS.INSTALL_ID);
}

async function purgeAlarm(worker: Worker): Promise<unknown> {
  return worker.evaluate((name) => chrome.alarms.get(name), ALARM_NAMES.PURGE);
}

/** Opens an extension page with console/pageerror capture attached before navigation. */
async function openWatched(attest: LaunchedExtension, page: string, problems: string[]): Promise<Page> {
  const tab = await attest.context.newPage();
  tab.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${page} console.${message.type()}: ${message.text()}`);
    }
  });
  tab.on('pageerror', (error) => problems.push(`${page} pageerror: ${error.name}`));
  await tab.goto(`chrome-extension://${attest.extensionId}/${page}`);
  return tab;
}

/** Asks the worker for the ledger export from an extension page (opens the ledger if needed). */
function exportFrom(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'ledger.export' } }),
  );
}

/** Watches the extension's worker through CDP: its running status history and any uncaught error. */
async function watchWorker(
  attest: LaunchedExtension,
  page: Page,
): Promise<{ cdp: CDPSession; statuses: string[]; workerErrors: string[] }> {
  const cdp = await attest.context.newCDPSession(page);
  const statuses: string[] = [];
  const workerErrors: string[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions) {
      if (version.scriptURL.startsWith(`chrome-extension://${attest.extensionId}/`)) {
        statuses.push(version.runningStatus);
      }
    }
  });
  cdp.on('ServiceWorker.workerErrorReported', ({ errorMessage }) => {
    workerErrors.push(`${errorMessage.sourceURL}:${String(errorMessage.lineNumber)}`);
  });
  return { cdp, statuses, workerErrors };
}

test.describe('service worker lifecycle', () => {
  test('install creates the install id and schedules the purge and grace alarms with their periods, the digest weekly', async ({
    attest,
  }) => {
    const worker = await attest.serviceWorker();
    await expect.poll(() => storedInstallId(worker)).toMatch(UUID_V4);
    await expect
      .poll(() => purgeAlarm(worker))
      .toMatchObject({ name: ALARM_NAMES.PURGE, periodInMinutes: PURGE_ALARM_PERIOD_MINUTES });
    const alarms = await worker.evaluate(() => chrome.alarms.getAll());
    // The grace alarm runs a grading batch every few minutes (sprint_3 3.13); the digest is a one-shot alarm, set again
    // each Monday (sprint_4 4.7).
    expect(alarms.map((alarm) => [alarm.name, alarm.periodInMinutes]).sort()).toEqual(
      [
        [ALARM_NAMES.PURGE, PURGE_ALARM_PERIOD_MINUTES],
        [ALARM_NAMES.GRADE, GRADE_ALARM_PERIOD_MINUTES],
        [ALARM_NAMES.DIGEST, undefined],
        // The opt-in telemetry's hourly look for a day to send (sprint_5 5.7): it sends nothing while telemetry is off.
        [ALARM_NAMES.TELEMETRY, TELEMETRY_ALARM_PERIOD_MINUTES],
      ].sort(),
    );
    // Its time on the worker's own clock: Monday at 09:00.
    const digestAt = await worker.evaluate(async () => {
      const alarm = await chrome.alarms.get('attest.digest');
      const at = new Date(alarm?.scheduledTime ?? 0);
      return [at.getDay(), at.getHours(), at.getMinutes()];
    });
    expect(digestAt).toEqual([1, 9, 0]);
  });

  test('popup, options and side panel open with zero console errors, warnings or exceptions', async ({
    attest,
  }) => {
    const worker = await attest.serviceWorker();
    await expect.poll(() => storedInstallId(worker)).toMatch(UUID_V4);
    const problems: string[] = [];
    for (const { page, ready } of EXTENSION_PAGES) {
      const tab = await openWatched(attest, page, problems);
      await expect(tab.locator(ready)).toBeVisible();
    }
    expect(problems).toEqual([]);
  });
});

test.describe('service worker lifecycle: Chrome stops the worker', () => {
  test('after Chrome stops the worker, a bus query restarts it cleanly with its state intact', async ({
    attest,
  }) => {
    const first = await attest.serviceWorker();
    await expect.poll(() => storedInstallId(first)).toMatch(UUID_V4);
    await expect.poll(() => purgeAlarm(first)).toMatchObject({ name: ALARM_NAMES.PURGE });
    const idBefore = await storedInstallId(first);
    const alarmBefore = await purgeAlarm(first);

    const problems: string[] = [];
    const options = await openWatched(attest, 'options.html', problems);
    await expect(options.locator('#install-id-value')).toHaveText(UUID_V4);
    // Open the ledger (the export does), then put one known row in it so "same ledger" means something.
    await exportFrom(options);
    await plantIndexedDbProbe(options, 1, 'qa.restart_probe');
    const before = await exportFrom(options);
    expect(before).toMatchObject({ type: 'ui.result', kind: 'ledger.export', ok: true });

    const { cdp, statuses, workerErrors } = await watchWorker(attest, options);
    // The DevTools session survives a stop, so `first` now reports the restarted instance's console.
    const workerLines: string[] = [];
    first.on('console', (message) => workerLines.push(`${message.type()} ${message.text()}`));
    await cdp.send('ServiceWorker.enable');

    // Stop every service worker of this profile, as Chrome does to an idle MV3 worker.
    await cdp.send('ServiceWorker.stopAllWorkers');
    await expect.poll(() => statuses.at(-1)).toBe('stopped');

    // A message wakes the worker; it is answered only if listen() ran at top level of the new instance.
    const after = await exportFrom(options);
    expect(statuses.slice(statuses.lastIndexOf('stopped'))).toEqual(
      expect.arrayContaining(['stopped', 'starting', 'running']),
    );
    expect(after).toMatchObject({ type: 'ui.result', kind: 'ledger.export', ok: true });
    // Same ledger: identical tables before and after (the export time differs, nothing else).
    const tablesOf = (result: unknown): unknown =>
      (result as { data?: { tables?: unknown } } | undefined)?.data?.tables;
    expect(tablesOf(before)).toMatchObject({ meta: [{ key: 'qa.restart_probe', value: 1 }] });
    expect(tablesOf(after)).toEqual(tablesOf(before));

    // main() ran again from the top, and said nothing alarming.
    await expect
      .poll(() => workerLines.some((line) => line.includes('"event":"background.started"')))
      .toBe(true);
    expect(workerLines.filter((line) => /^(error|warning) /.test(line))).toEqual([]);
    expect(workerErrors).toEqual([]);
    expect(await storedInstallId(first)).toBe(idBefore);
    expect(await purgeAlarm(first)).toEqual(alarmBefore);
    expect(problems).toEqual([]);
  });
});

test.describe('service worker lifecycle: the browser restarts', () => {
  test('after a browser restart the purge alarm exists again, even if it was dropped, and the id is kept', async () => {
    test.setTimeout(2 * 60_000); // two browser launches, one after the other
    const profile = mkdtempSync(path.join(os.tmpdir(), 'attest-restart-'));
    try {
      const firstRun = await launchExtension({ userDataDir: profile });
      const before = await firstRun.serviceWorker();
      await expect.poll(() => storedInstallId(before)).toMatch(UUID_V4);
      await expect.poll(() => purgeAlarm(before)).toMatchObject({ name: ALARM_NAMES.PURGE });
      const id = await storedInstallId(before);
      // Simulate Chrome dropping the alarm across the restart.
      expect(await before.evaluate((name) => chrome.alarms.clear(name), ALARM_NAMES.PURGE)).toBe(true);
      await firstRun.close();

      const secondRun = await launchExtension({ userDataDir: profile });
      try {
        const after = await secondRun.serviceWorker();
        await expect
          .poll(() => purgeAlarm(after))
          .toMatchObject({ name: ALARM_NAMES.PURGE, periodInMinutes: PURGE_ALARM_PERIOD_MINUTES });
        expect(await storedInstallId(after)).toBe(id);
      } finally {
        await secondRun.close();
      }
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });
});

test.describe('service worker lifecycle: Chrome stops the worker mid-grace (rule 6; QA review GAP 3)', () => {
  test('a receipt still PENDING when the worker stops is FINAL after the next grace alarm, and replays', async () => {
    test.setTimeout(3 * 60_000);
    await withVendorSession(async (session) => {
      // A send claimed 74 minutes ago, past its grace, to an address no Sent list holds. No Gmail tab is open yet, so
      // the import's batch has no coverage for it: UNVERIFIABLE, PENDING.
      const panel = await session.extension.openExtensionPage('sidepanel.html');
      const log = ['Sent an email to nobody@example.net', datedClock(74, FIXTURE_TIME_ZONE)].join('\n');
      expect(await pasteActivity(panel, 'Muse', log)).toBe('Imported 1 claim.');
      const stateOf = async () =>
        (await readLedger(session.ledgerPage)).tables.receipts.map((r) => [r.grade, r.state]);
      expect(await stateOf()).toEqual([['UNVERIFIABLE', 'PENDING']]);

      // Chrome stops the worker, as it stops an idle MV3 worker at any time.
      const cdp = await session.extension.context.newCDPSession(session.ledgerPage);
      const statuses: string[] = [];
      cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        for (const version of versions) statuses.push(version.runningStatus);
      });
      await cdp.send('ServiceWorker.enable');
      await cdp.send('ServiceWorker.stopAllWorkers');
      await expect.poll(() => statuses.at(-1)).toBe('stopped');

      // The person opens Gmail's Sent list: its pass wakes the worker and is stored with the head's coverage. No batch
      // runs after a pass; the next grace alarm's does, from what the ledger holds, and finalises the receipt.
      const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
      session.routes.set(requestUrl(fixtureUrl(sent)), readFileSync(sent.htmlPath, 'utf8'));
      const gmail = await session.extension.context.newPage();
      await gmail.goto(fixtureUrl(sent));
      await waitForLedger(session.ledgerPage, (ledger) =>
        ledger.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
      );
      expect(statuses.slice(statuses.lastIndexOf('stopped'))).toEqual(
        expect.arrayContaining(['stopped', 'starting', 'running']),
      );
      expect(await stateOf()).toEqual([['UNVERIFIABLE', 'PENDING']]);
      await session.ledgerPage.evaluate(
        ({ name, period }) => chrome.alarms.create(name, { when: Date.now() + 500, periodInMinutes: period }),
        { name: ALARM_NAMES.GRADE, period: GRADE_ALARM_PERIOD_MINUTES },
      );
      await expect.poll(stateOf, { timeout: 60_000 }).toEqual([['NOT_FOUND', 'FINAL']]);
      expect(replayExport(await readLedger(session.ledgerPage))).toMatch(/^ {2}reproduced {2}1$/mu);
    });
  });
});
