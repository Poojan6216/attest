/**
 * @mandatory — Hard Rule 1: nothing leaves the browser.
 *
 * Runs the real build through a 5-minute scripted session (three fixture pages, the Gmail and Calendar
 * fixtures with their content scripts running (sprint_2 2.7), popup, options, side panel, an alarm firing)
 * with Chromium's NetLog on, then asserts that every request the
 * extension or a page initiated went to an allowlisted host. In this sprint the allowlist is empty.
 * The negative control proves on every run that the guard sees a canary request from the service
 * worker, an extension page and a fixture page. This test is never skipped, retried, or weakened. (If
 * Chromium's own start-up hangs, the launcher replaces the browser before the session starts; every attempt
 * writes its own NetLog and every one is analysed: tests/e2e/support/extension.ts.)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { NETWORK_ALLOWLIST } from '../../src/config';
import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';
import { recordConsole } from './support/channels';
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

/** Sprint 0: empty. Sprint 5 adds exactly the telemetry host, and only while telemetry is on. */
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
  }
  return pages;
}

/**
 * The negative control's canary requests: a fetch and a WebSocket from the service worker, a fetch from an extension
 * page and a fetch from a fixture page. Each host must come back as a violation.
 */
async function plantCanaries(session: GuardedSession): Promise<void> {
  const worker = await session.extension.serviceWorker();
  await worker.evaluate(() => fetch('https://sw-canary.example.com/attest').catch(() => undefined));
  // Playwright routing never sees WebSockets, so only the NetLog layer can catch this one.
  await worker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket('wss://ws-canary.example.com/attest');
        socket.onerror = () => {
          resolve();
        };
        socket.onclose = () => {
          resolve();
        };
      }),
  );
  const options = await session.extension.openExtensionPage('options.html');
  await options.evaluate(() => fetch('https://page-canary.example.org/attest').catch(() => undefined));
  const fixture = await session.extension.context.newPage();
  await fixture.goto(session.server.url('_harness/blank.html'));
  await fixture.evaluate(() => fetch('https://fixture-canary.example.net/attest').catch(() => undefined));
}

test.describe('nothing leaves the browser', { tag: '@mandatory' }, () => {
  test('the allowlist asserted here is the allowlist the extension ships', () => {
    expect([...NETWORK_ALLOWLIST]).toEqual([...ALLOWLIST]);
  });

  test('a 5-minute scripted session makes no request outside the allowlist', async () => {
    test.setTimeout(SESSION_MS + 3 * 60_000);
    const session = await startGuardedSession();
    const deadline = Date.now() + SESSION_MS;
    let report: NetworkReport;
    try {
      const pages = await openAll(session);
      // Fire the extension's own alarm well inside the session (Chrome's floor is 30 s).
      const worker = await session.extension.serviceWorker();
      await worker.evaluate(() => chrome.alarms.create('attest.purge', { delayInMinutes: 0.5 }));
      let step = 0;
      while (Date.now() < deadline) {
        const page = pages[step % pages.length];
        if (page !== undefined) await page.reload();
        step += 1;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(STEP_MS, Math.max(0, deadline - Date.now()))),
        );
      }
      expect(session.consoleLines.some((line) => line.includes('"event":"alarm.fired"'))).toBe(true);
      // Every page was reloaded repeatedly over the whole session.
      expect(step).toBeGreaterThanOrEqual(2 * pages.length);
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
      expect.arrayContaining([
        'sw-canary.example.com',
        'page-canary.example.org',
        'fixture-canary.example.net',
        'ws-canary.example.com',
      ]),
    );
    // The WebSocket canary is attributed by NetLog alone: the ground-truth layer works on its own.
    expect(report.attributed).toContainEqual(
      expect.objectContaining({ host: 'ws-canary.example.com', via: 'netlog' }),
    );
  });
});
