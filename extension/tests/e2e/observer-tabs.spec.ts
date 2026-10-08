/**
 * Sprint 2.11 (Read: agents/adapter_engineer.md; live smoke finding 2): gmail.sent health with several Gmail tabs,
 * in the shipped build. A tab on another folder reports IDLE (not a Sent list: neither OK nor broken), and the
 * ledger keeps the status a Sent list gave (src/ledger/health.ts), so the stored health no longer flips with
 * whichever tab posted last (Hard Rule 6):
 *  - with a Sent tab and an Inbox tab open, the stored gmail.sent health is the Sent tab's OK, after the Inbox tab's
 *    own IDLE report was handled;
 *  - a real break on a Sent list (its time cells gone) is DEGRADED, and stays so while the Inbox tab reports again.
 * The real reports are seen arriving in the service worker, through a listener the test adds beside the extension's.
 * Then a neutral report is sent from the Inbox tab's content-script world (an OK dated before the stored one, which
 * the ledger never stores) and its answer awaited: one observer's messages are handled one at a time, in arrival
 * order (src/background/observer-state.ts `serially`), so every report before it has been handled when it answers.
 */
import { readFileSync } from 'node:fs';

import { expect, type Page, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import type { LedgerExport } from '../../src/ledger/export';
import { SENT_SELECTORS } from '../../src/observers/gmail/selectors';
import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';
import { contentScriptPost } from './support/content-world';
import { launchExtension, type LaunchedExtension } from './support/extension';
import { installRouteGuard } from './support/network-guard';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  openVendorPage,
  readLedger,
  requestUrl,
  type VendorRoutes,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

declare const chrome: WxtBrowser;

interface Session {
  readonly server: FixtureServer;
  readonly extension: LaunchedExtension;
  readonly routes: VendorRoutes;
  /** An extension page the test asks the ledger from. */
  readonly ledgerPage: Page;
}

async function withSession(run: (session: Session) => Promise<void>): Promise<void> {
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    const routes: VendorRoutes = new Map();
    await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
    const ledgerPage = await extension.openExtensionPage('options.html');
    await run({ server, extension, routes, ledgerPage });
  } finally {
    await extension.close();
    await server.close();
  }
}

/** A gmail.sent report as the service worker received it: from which page, saying what. */
interface SeenReport {
  readonly url: string;
  readonly status: string;
  readonly reasons: readonly string[];
}

/** Runs in the service worker: keeps every gmail.sent health report it receives, beside the extension's listener. */
function watchSentReports(): void {
  const seen: SeenReport[] = [];
  Reflect.set(globalThis, 'attestE2eSentReports', seen);
  chrome.runtime.onMessage.addListener((message: unknown, sender: { readonly url?: string }) => {
    if (typeof message !== 'object' || message === null) return undefined;
    const health: unknown = Reflect.get(message, 'health');
    if (Reflect.get(message, 'type') !== 'adapter.health' || typeof health !== 'object' || health === null)
      return undefined;
    if (Reflect.get(health, 'adapterId') !== 'gmail.sent') return undefined;
    const reasons: unknown = Reflect.get(health, 'reasons');
    seen.push({
      url: sender.url ?? '',
      status: String(Reflect.get(health, 'status')),
      reasons: Array.isArray(reasons) ? reasons.map(String) : [],
    });
    return undefined;
  });
}

/** The reports the service worker has received so far (watchSentReports). */
async function sentReports(session: Session): Promise<SeenReport[]> {
  const worker = await session.extension.serviceWorker();
  return worker.evaluate(() => Reflect.get(globalThis, 'attestE2eSentReports') as SeenReport[]);
}

/** Waits until the Inbox tab has reported more than `before` times, and returns its reports. */
async function inboxReportsAfter(session: Session, before: number): Promise<SeenReport[]> {
  let inbox: SeenReport[] = [];
  await expect
    .poll(async () => {
      inbox = (await sentReports(session)).filter((report) => report.url.includes('#inbox'));
      return inbox.length;
    })
    .toBeGreaterThan(before);
  return inbox;
}

/** Sends the neutral report from `tab` (module comment) and waits for its answer: every earlier report is handled. */
async function handled(session: Session, tab: Page): Promise<void> {
  const post = await contentScriptPost(tab, session.extension.extensionId);
  const answer = await post({
    type: 'adapter.health',
    health: {
      adapterId: 'gmail.sent',
      version: SENT_SELECTORS.version,
      status: 'OK',
      reasons: [],
      checkedAt: '2020-01-01T00:00:00Z',
    },
  });
  expect(answer).toEqual({ ok: true });
}

const sentHealth = (ledger: LedgerExport) =>
  ledger.tables.adapterHealth.find((report) => report.adapterId === 'gmail.sent');

/** The Sent page with its time cells gone: a selector that broke on a real Sent list. */
function brokenSentList(): { url: string; html: string } {
  const page = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  const html = readFileSync(page.htmlPath, 'utf8').replace(
    /<span title="[^"]*" aria-label="[^"]*"><span>[^<]*<\/span><\/span>/gu,
    '',
  );
  const url = new URL(fixtureUrl(page));
  url.searchParams.set('fixture', 'broken-sent-page-1');
  return { url: url.href, html };
}

async function tabsKeepTheSentStatus(session: Session): Promise<void> {
  const worker = await session.extension.serviceWorker();
  await worker.evaluate(watchSentReports);
  const sent = await openVendorPage(
    session.extension.context,
    session.routes,
    vendorFixture('gmail', 'synthetic-sent-page-1.html'),
  );
  const ok = await waitForLedger(session.ledgerPage, (ledger) => sentHealth(ledger)?.status === 'OK');
  const okAt = sentHealth(ok)?.checkedAt;

  const inbox = await openVendorPage(
    session.extension.context,
    session.routes,
    vendorFixture('gmail', 'synthetic-inbox.html'),
  );
  const first = await inboxReportsAfter(session, 0);
  expect(first.map((report) => [report.status, report.reasons])).toContainEqual([
    'IDLE',
    ['not_sent_folder'],
  ]);
  expect(first.every((report) => report.status === 'IDLE')).toBe(true);
  await handled(session, inbox);
  expect(sentHealth(await readLedger(session.ledgerPage))).toMatchObject({ status: 'OK', checkedAt: okAt });

  const broken = brokenSentList();
  session.routes.set(requestUrl(broken.url), broken.html);
  await sent.goto('about:blank');
  await sent.goto(broken.url);
  const degraded = await waitForLedger(
    session.ledgerPage,
    (ledger) => sentHealth(ledger)?.status === 'DEGRADED',
  );
  expect(sentHealth(degraded)?.reasons).toEqual(['selector.missing.time']);

  await inbox.reload();
  await inboxReportsAfter(session, first.length);
  await handled(session, inbox);
  expect(sentHealth(await readLedger(session.ledgerPage))).toEqual(sentHealth(degraded));
}

test.describe('gmail.sent health with several Gmail tabs (sprint_2 2.11)', () => {
  test('an Inbox tab never flips the Sent tab status: OK stays OK, and a real break stays DEGRADED', async () => {
    test.setTimeout(3 * 60_000);
    await withSession(tabsKeepTheSentStatus);
  });
});
