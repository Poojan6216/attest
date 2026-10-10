/**
 * The person's own key saved but off sends nothing, while a claim it could raise is due (Sprint 5 close, QA GAP 6;
 * sprint_5 5.3; Hard Rule 1). On the built extension, an invented Anthropic key is saved and left off, Gmail's Sent list
 * shows the send to Priya, and the paraphrased claim lands PARTIAL in its grace (./support/priya.ts). The grace alarm's
 * batch then runs to its end (`alarm.done`, logged once the model's step is over): Anthropic's stand-in hears nothing,
 * no model answer is stored, the claim stays PARTIAL, and NetLog and the route guard see no host at all, under the
 * allowlist of everything off.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { ALARM_NAMES, allowedHosts } from '../../src/config';
import type { LedgerExport } from '../../src/ledger/export';
import { startFixtureServer } from '../tools/serve-fixtures';
import { saveKey } from './support/byo-key';
import { recordConsole } from './support/channels';
import { launchExtension } from './support/extension';
import { stubAnthropic } from './support/model-vendor';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import { analyse, guardArgs, installRouteGuard } from './support/network-guard';
import { clockAt, pasteActivity } from './support/paste';
import { claimOf, MINUTE_MS, openSent } from './support/priya';
import { FIXTURE_TIME_ZONE, type VendorRoutes, waitForLedger } from './support/vendor-pages';

declare const chrome: WxtBrowser;

const INVENTED_KEY = 'sk-ant-invented-off-7Hq2Lm9Np3Rs4TvX';

test('a key saved but off: the vendor hears nothing while a claim it could raise is due', async () => {
  test.setTimeout(3 * 60_000);
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-netlog-intel-off-'));
  const routes: VendorRoutes = new Map();
  const extension = await launchExtension({
    extraArgs: (attempt) => guardArgs(netLogPathFor(dir, attempt)),
    timezoneId: FIXTURE_TIME_ZONE,
  });
  try {
    const guarded = await installRouteGuard(extension.context, {
      fixtureOrigin: server.origin,
      routedFixtures: routes,
    });
    const asked = await stubAnthropic(extension.context);
    const worker = await extension.serviceWorker();
    const lines: string[] = [];
    recordConsole(worker, 'service-worker', lines);
    await saveKey(extension, INVENTED_KEY, { turnOn: false });
    const ledgerPage = await extension.openExtensionPage('options.html');
    const nowMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
    const priyaMs = nowMs - 5 * MINUTE_MS;
    await openSent(extension, routes, ledgerPage, nowMs, priyaMs);
    const panel = await extension.openExtensionPage('sidepanel.html');
    const log = ['Sent email "Quarterly deck" to Priya', clockAt(priyaMs, FIXTURE_TIME_ZONE)].join('\n');
    expect(await pasteActivity(panel, 'Muse', log)).toBe('Imported 1 claim.');
    const partial = (read: LedgerExport) => claimOf(read, 'Priya').receipt?.grade === 'PARTIAL';
    await waitForLedger(ledgerPage, partial);
    // The grace alarm, run to its end: its batch, then the model's step, which asks nothing with the key off.
    const graceDone = (): number =>
      lines.filter((line) => line.includes('"event":"alarm.done"') && line.includes(ALARM_NAMES.GRADE))
        .length;
    await worker.evaluate(
      (name) => chrome.alarms.create(name, { when: Date.now() + 300 }),
      ALARM_NAMES.GRADE,
    );
    await expect.poll(graceDone, { timeout: 30_000 }).toBeGreaterThan(0);
    const after = await waitForLedger(ledgerPage, partial);
    await extension.close();
    const report = analyse(readNetLogRequests(dir), guarded, {
      fixtureOrigin: server.origin,
      allowlist: allowedHosts({ telemetry: false, byo: null }),
      routedFixtureUrls: new Set(routes.keys()),
    });
    expect(asked).toEqual([]);
    expect(after.tables.modelAnswers).toEqual([]);
    expect(claimOf(after, 'Priya').receipt).toMatchObject({ grade: 'PARTIAL', state: 'PENDING' });
    expect(report.violations).toEqual([]);
    expect(report.unknownBrowserHosts).toEqual([]);
  } finally {
    await extension.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
