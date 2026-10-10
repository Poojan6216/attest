/**
 * @mandatory — Hard Rule 1: nothing leaves the browser.
 *
 * Runs the real build through a scripted session (three fixture pages, the Gmail and Calendar fixtures with their
 * content scripts running (sprint_2 2.7), popup, options, side panel, an alarm firing) with Chromium's NetLog on,
 * then asserts that every request the extension or a page initiated went to an allowlisted host. With the opt-in
 * telemetry and the person's own model key off, as here, the allowlist is empty. Sprint 4's surfaces run first (sprint_4 close, QA review GAP 7; ./support/sprint4-surfaces.ts):
 * Check Gmail for me opening its tab, alerts, a receipt's share and image, the weekly digest with its page and share,
 * a grant saved, both exports, a reader turned off and on, and Delete all data. Then every page is reloaded in turn
 * for 5 minutes.
 * The negative control proves on every run that the guard sees a canary request from the service
 * worker, an extension page and a fixture page. The extension's own canaries go to hosts its content security policy
 * lets it reach (the model vendors', the telemetry host: wxt.config.ts `connectSources`), since Chrome now refuses any
 * other host, and every WebSocket, before a request is made (Sprint 5 close, SEC-3; tests/e2e/csp.spec.ts proves that
 * refusal). The WebSocket canary, which only NetLog can see, so comes from the fixture page. With every option off none
 * of them is allowed, so each must come back as a violation. This test is never skipped, retried, or weakened. (If
 * Chromium's own start-up hangs, the launcher replaces the browser before the session starts; every attempt
 * writes its own NetLog and every one is analysed: tests/e2e/support/extension.ts.)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { allowedHosts, BYO_VENDORS, NETWORK_ALLOWLIST, TELEMETRY_HOST } from '../../src/config';
import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';
import { recordConsole } from './support/channels';
import { datedClock, pasteActivity } from './support/paste';
import type { VendorSession } from './support/session';
import { checkGmailForMe, sprint4Surfaces } from './support/sprint4-surfaces';
import { FIXTURE_TIME_ZONE, fixtureUrl, routesFor, vendorFixture } from './support/vendor-pages';
import { launchExtension, type LaunchedExtension } from './support/extension';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import {
  analyse,
  guardArgs,
  installRouteGuard,
  type NetworkReport,
  type RouteRecord,
} from './support/network-guard';

declare const chrome: WxtBrowser;

/**
 * Empty: the session runs with the opt-in telemetry and the person's own model key off, so the extension may contact
 * no host (src/config.ts `allowedHosts` with both off). With either on, exactly its one host is allowed, and
 * tests/e2e/telemetry.spec.ts and tests/e2e/intel.spec.ts hold the extension to that (sprint_5 5.4, 5.7).
 */
const ALLOWLIST: readonly string[] = [];
const SESSION_MS = 5 * 60_000;
// One reload every STEP_MS: with the observer fixtures (sprint_2 2.7) nine pages, each reloaded at least twice.
const STEP_MS = 8_000;
const FIXTURE_PAGES = ['_harness/blank.html', '_harness/mail-like.html', '_harness/calendar-like.html'];
const EXTENSION_PAGES = ['popup.html', 'options.html', 'sidepanel.html'];
/**
 * Sprint 2.7: the Gmail and Calendar fixtures at the vendors' own addresses (./support/vendor-pages.ts, routed, never
 * fetched), so the observers' content scripts run, post and store through the whole session.
 */
const VENDOR_PAGES = [
  vendorFixture('gmail', 'synthetic-sent-page-1.html'),
  vendorFixture('gmail', 'synthetic-receipt-stripe.html'),
  vendorFixture('gcal', 'synthetic-gcal-week-before.html'),
  // Real captures (2026-10-06), so the content scripts run on what the real pages draw (QA-R5).
  vendorFixture('gmail', 'sent-list-1.html'),
  vendorFixture('gcal', 'week-after.html'),
  // Real receipts (2026-10-07): the receipt reader on real opened mail (QA third review).
  vendorFixture('gmail', 'receipt-stripe.html'),
  vendorFixture('gmail', 'receipt-uber.html'),
];
const VENDOR_ROUTES = routesFor(VENDOR_PAGES);

interface GuardedSession {
  readonly server: FixtureServer;
  readonly extension: LaunchedExtension;
  readonly routeRecords: RouteRecord[];
  readonly consoleLines: string[];
  /** Holds one NetLog per browser launch attempt (netlog-<n>.json); every one is analysed. */
  readonly dir: string;
}

async function startGuardedSession(): Promise<GuardedSession> {
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-netlog-'));
  let extension: LaunchedExtension | undefined;
  try {
    extension = await launchExtension({
      extraArgs: (attempt) => guardArgs(netLogPathFor(dir, attempt)),
      timezoneId: FIXTURE_TIME_ZONE,
    });
    const routeRecords = await installRouteGuard(extension.context, {
      fixtureOrigin: server.origin,
      routedFixtures: VENDOR_ROUTES,
    });
    const consoleLines: string[] = [];
    recordConsole(await extension.serviceWorker(), 'service-worker', consoleLines);
    return { server, extension, routeRecords, consoleLines, dir };
  } catch (error) {
    // A failed start must not leave a browser or a server behind to block worker teardown (QA-V2).
    await extension?.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Closes the browser (which flushes NetLog), then analyses everything that was requested. */
async function finishGuardedSession(session: GuardedSession): Promise<NetworkReport> {
  await session.extension.close();
  await session.server.close();
  const report = analyse(readNetLogRequests(session.dir), session.routeRecords, {
    fixtureOrigin: session.server.origin,
    allowlist: ALLOWLIST,
    routedFixtureUrls: new Set(VENDOR_ROUTES.keys()),
  });
  rmSync(session.dir, { recursive: true, force: true });
  return report;
}

function logReport(report: NetworkReport): void {
  console.log(`[network-intercept] attributed requests: ${String(report.attributed.length)}`);
  for (const request of report.attributed) {
    console.log(
      `[network-intercept] BLOCKED ${request.host} via=${request.via} initiator=${request.initiator}`,
    );
  }
  console.log(`[network-intercept] violations: ${JSON.stringify(report.violations)}`);
  console.log(
    `[network-intercept] unknown browser-initiated hosts: ${JSON.stringify(report.unknownBrowserHosts)}`,
  );
  console.log(
    `[network-intercept] ignored Chromium background hosts: ${JSON.stringify(report.browserInternalHosts)}`,
  );
}

async function openAll(session: GuardedSession): Promise<Page[]> {
  const pages: Page[] = [];
  for (const fixture of FIXTURE_PAGES) {
    const page = await session.extension.context.newPage();
    recordConsole(page, fixture, session.consoleLines);
    await page.goto(session.server.url(fixture));
    pages.push(page);
  }
  for (const fixture of VENDOR_PAGES) {
    const page = await session.extension.context.newPage();
    recordConsole(page, fixture.file, session.consoleLines);
    await page.goto(fixtureUrl(fixture));
    pages.push(page);
  }
  for (const extensionPage of EXTENSION_PAGES) {
    const page = await session.extension.openExtensionPage(extensionPage);
    recordConsole(page, extensionPage, session.consoleLines);
    pages.push(page);
    // A pasted log imported and graded through the side panel (sprint_3 3.13): that path makes no request either.
    if (extensionPage === 'sidepanel.html') {
      const log = ['Sent an email to sam@example.com', datedClock(30, FIXTURE_TIME_ZONE)].join('\n');
      expect(await pasteActivity(page, 'Claude', log)).toBe('Imported 1 claim.');
    }
  }
  return pages;
}

/** The session as the shared flows take it: the vendor routes, and an options page to ask the ledger from. */
async function vendorSessionOf(session: GuardedSession): Promise<VendorSession> {
  const ledgerPage = await session.extension.openExtensionPage('options.html');
  return { server: session.server, extension: session.extension, routes: VENDOR_ROUTES, ledgerPage };
}

/**
 * Opens every page, with Sprint 4's surfaces around them: Check Gmail for me before any Gmail page is read, the rest
 * after. Resolves the pages to reload, the tab Attest opened and the digest page among them.
 */
async function openEverything(session: GuardedSession): Promise<Page[]> {
  const vendor = await vendorSessionOf(session);
  const autoCheckTab = await checkGmailForMe(vendor);
  const pages = await openAll(session);
  const digest = await sprint4Surfaces(vendor);
  recordConsole(autoCheckTab, 'auto-check tab', session.consoleLines);
  recordConsole(digest, 'digest.html', session.consoleLines);
  return [...pages, autoCheckTab, digest];
}

/** Reloads `pages` in turn, one every STEP_MS, for `ms`; resolves how many reloads it made. */
async function reloadInTurn(pages: readonly Page[], ms: number): Promise<number> {
  const deadline = Date.now() + ms;
  let step = 0;
  while (Date.now() < deadline) {
    const page = pages[step % pages.length];
    if (page !== undefined) await page.reload();
    step += 1;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(STEP_MS, Math.max(0, deadline - Date.now()))),
    );
  }
  return step;
}

/**
 * The canaries' hosts. The extension's are hosts its content security policy lets it reach, one per context, so that
 * each request is really made; the fixture page's, a fetch and a WebSocket, are any hosts, a page being outside that
 * policy.
 */
const CANARY = {
  worker: new URL(BYO_VENDORS.openai.endpoint).host,
  page: TELEMETRY_HOST,
  fixture: 'fixture-canary.example.net',
  socket: 'ws-canary.example.com',
} as const;

/**
 * The negative control's canary requests: a fetch from the service worker, a fetch from an extension page, and a fetch
 * and a WebSocket from a fixture page. Each host must come back as a violation.
 */
async function plantCanaries(session: GuardedSession): Promise<void> {
  const worker = await session.extension.serviceWorker();
  await worker.evaluate(
    (host) => fetch(`https://${host}/attest-canary`).catch(() => undefined),
    CANARY.worker,
  );
  const options = await session.extension.openExtensionPage('options.html');
  await options.evaluate(
    (host) => fetch(`https://${host}/attest-canary`).catch(() => undefined),
    CANARY.page,
  );
  const fixture = await session.extension.context.newPage();
  await fixture.goto(session.server.url('_harness/blank.html'));
  await fixture.evaluate((host) => fetch(`https://${host}/attest`).catch(() => undefined), CANARY.fixture);
  // Playwright routing never sees WebSockets, so only the NetLog layer can catch this one.
  await fixture.evaluate(
    (host) =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket(`wss://${host}/attest`);
        socket.onerror = () => {
          resolve();
        };
        socket.onclose = () => {
          resolve();
        };
      }),
    CANARY.socket,
  );
}

test.describe('nothing leaves the browser', { tag: '@mandatory' }, () => {
  test('the allowlist asserted here is the allowlist the extension ships', () => {
    expect([...NETWORK_ALLOWLIST]).toEqual([...ALLOWLIST]);
    expect(allowedHosts({ telemetry: false, byo: null })).toEqual([...ALLOWLIST]);
  });

  test('a 5-minute scripted session makes no request outside the allowlist', async () => {
    // Sprint 4's surfaces take a minute or two before the 5 minutes of reloads start.
    test.setTimeout(SESSION_MS + 6 * 60_000);
    const session = await startGuardedSession();
    let report: NetworkReport;
    try {
      const pages = await openEverything(session);
      // Fire the extension's own alarm well inside the session (Chrome's floor is 30 s).
      const worker = await session.extension.serviceWorker();
      await worker.evaluate(() => chrome.alarms.create('attest.purge', { delayInMinutes: 0.5 }));
      const steps = await reloadInTurn(pages, SESSION_MS);
      expect(session.consoleLines.some((line) => line.includes('"event":"alarm.fired"'))).toBe(true);
      // Every page was reloaded repeatedly over the whole session.
      expect(steps).toBeGreaterThanOrEqual(2 * pages.length);
    } finally {
      report = await finishGuardedSession(session);
    }
    logReport(report);
    expect(report.violations).toEqual([]);
    expect(report.unknownBrowserHosts).toEqual([]);
  });

  test('negative control: the guard catches a request from the worker, an extension page, and a page', async () => {
    // Room for the launcher to replace a hung Chromium start-up (3 × 15 s, ./support/extension.ts) on a busy machine.
    test.setTimeout(3 * 60_000);
    const session = await startGuardedSession();
    let report: NetworkReport;
    try {
      await plantCanaries(session);
    } finally {
      report = await finishGuardedSession(session);
    }
    logReport(report);
    expect(report.violations).toEqual(
      expect.arrayContaining([CANARY.worker, CANARY.page, CANARY.fixture, CANARY.socket]),
    );
    // The WebSocket canary is attributed by NetLog alone: the ground-truth layer works on its own.
    expect(report.attributed).toContainEqual(expect.objectContaining({ host: CANARY.socket, via: 'netlog' }));
  });
});
