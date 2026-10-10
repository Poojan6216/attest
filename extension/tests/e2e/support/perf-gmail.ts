/**
 * Measuring the Gmail Sent reader on a generated Sent head of many rows (sprint_6 6.4; ./big-sent.ts), for
 * tests/e2e/perf-gmail.spec.ts to gate and bench/perf.ts to record:
 *  - `timeSentPasses`: one pass of the shipped reader (./sent-pass-harness.ts) on fresh loads of the page in a Chromium
 *    without the extension, each timed by the page's own clock;
 *  - `readTwice`: the built extension reading the page, then reading it again after a reload: how long the first pass
 *    took to reach the ledger, and what the ledger holds after each.
 * Every request but the page is refused, and both browsers run behind the dead proxy.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import type { LedgerExport } from '../../../src/ledger/export';
import { startFixtureServer } from '../../tools/serve-fixtures';
import { bigSentPage } from './big-sent';
import { launchExtension } from './extension';
import { DEAD_PROXY_ARG, installRouteGuard } from './network-guard';
import { MINUTE_MS } from './priya';
import { bundleTestScript } from './test-bundle';
import { FIXTURE_TIME_ZONE, readLedger, requestUrl, type VendorRoutes } from './vendor-pages';

const HARNESS_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sent-pass-harness.ts');

/** What the page's timer returns (./sent-pass-harness.ts), parsed rather than trusted. */
const TimedPass = z.strictObject({
  ms: z.number(),
  status: z.string(),
  observations: z.number(),
  marker: z.string(),
});
export type TimedPass = z.infer<typeof TimedPass>;

const nowMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

/** `runs` passes of the shipped Sent reader over a head of `rows` rows, each on a fresh load of the page. */
export async function timeSentPasses(rows: number, runs: number): Promise<TimedPass[]> {
  const bundle = await bundleTestScript(HARNESS_ENTRY, 'AttestSentPassHarness');
  const nowMs = nowMinute();
  const page = bigSentPage(rows, nowMs - MINUTE_MS);
  const browser = await chromium.launch({ args: [DEAD_PROXY_ARG] });
  try {
    const context = await browser.newContext({ timezoneId: FIXTURE_TIME_ZONE });
    await context.route('**/*', (route) =>
      route.request().url() === requestUrl(page.url)
        ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page.html })
        : route.abort('blockedbyclient'),
    );
    const passes: TimedPass[] = [];
    for (let run = 0; run < runs; run += 1) {
      const tab = await context.newPage();
      await tab.goto(page.url);
      await tab.addScriptTag({ content: bundle });
      const timed: unknown = await tab.evaluate((at) => {
        const timer: unknown = Reflect.get(window, '__attestTimeSentPass');
        return typeof timer === 'function' ? (Reflect.apply(timer, undefined, [at]) as unknown) : null;
      }, new Date(nowMs).toISOString());
      passes.push(TimedPass.parse(timed));
      await tab.close();
    }
    return passes;
  } finally {
    await browser.close();
  }
}

/**
 * Reads the ledger every two seconds until `holds`: the export reads every table, so a tighter poll would compete with
 * the very writes being timed.
 */
async function slowPoll(
  page: Page,
  holds: (ledger: LedgerExport) => boolean,
  timeoutMs: number,
): Promise<LedgerExport> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ledger = await readLedger(page);
    if (holds(ledger)) return ledger;
    if (Date.now() > deadline) throw new Error('the ledger never held what the measure waits for');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

const sentWindows = (ledger: LedgerExport) =>
  ledger.tables.coverageIntervals.filter((entry) => entry.source === 'gmail.sent');

export interface TwoReads {
  /** From opening the page to every row stored with its window. */
  readonly storeMs: number;
  readonly afterFirst: number;
  readonly afterSecond: number;
  readonly windows: number;
}

/** The built extension reading a head of `rows` rows, then reading it again after a reload. */
export async function readTwice(rows: number): Promise<TwoReads> {
  const server = await startFixtureServer();
  const routes: VendorRoutes = new Map();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
    const page = bigSentPage(rows, nowMinute() - MINUTE_MS);
    routes.set(requestUrl(page.url), page.html);
    const ledgerPage = await extension.openExtensionPage('options.html');
    const gmail = await extension.context.newPage();
    const started = Date.now();
    await gmail.goto(page.url);
    const read = (ledger: LedgerExport) =>
      ledger.tables.observations.length >= rows && sentWindows(ledger).length > 0;
    const first = await slowPoll(ledgerPage, read, 5 * 60_000);
    const storeMs = Date.now() - started;
    const reloadedMs = Math.floor(Date.now() / 1000) * 1000;
    await gmail.reload();
    const again = (ledger: LedgerExport) =>
      ledger.tables.adapterHealth.some(
        (report) => report.adapterId === 'gmail.sent' && Date.parse(report.checkedAt) >= reloadedMs,
      );
    await slowPoll(ledgerPage, again, 5 * 60_000);
    const second = await readLedger(ledgerPage);
    return {
      storeMs,
      afterFirst: first.tables.observations.length,
      afterSecond: second.tables.observations.length,
      windows: sentWindows(second).length,
    };
  } finally {
    await extension.close();
    await server.close();
  }
}
