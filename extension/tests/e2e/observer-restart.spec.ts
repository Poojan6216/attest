/**
 * The observer path survives a stopped service worker, in the shipped build (qa_tester rule 6; extension_engineer
 * rule 3; Decisions [2.7]). Added by the Sprint 2 QA review. Chrome stops an idle MV3 worker at any time; the next
 * message a content script posts must wake it (listeners registered at top level), and the next pass must be stored
 * as if nothing happened: the labelled rows once each, coverage that follows the rows, OK health.
 *
 * The labelled fixtures are opened at the vendors' own addresses (./support/vendor-pages.ts), so the real content
 * scripts run the real observers. Between two passes the test stops every service worker of the profile over CDP
 * (`ServiceWorker.stopAllWorkers`, as tests/e2e/worker-lifecycle.spec.ts does), checks it is stopped, then lets the
 * page wake it: the next Calendar week in the same tab, or a reload of the Sent list. The stop lands between passes;
 * a stop inside one pass (between its coverage ping and its snapshot) is the unit test
 * tests/unit/background/worker-restart.spec.ts, which can place it exactly.
 */
import { type CDPSession, expect, type Page, test } from '@playwright/test';

import { instantMs } from '../../src/core/normalize';
import type { LedgerExport } from '../../src/ledger/export';
import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';
import { launchExtension, type LaunchedExtension } from './support/extension';
import { installRouteGuard } from './support/network-guard';
import {
  expectedObservation,
  FIXTURE_TIME_ZONE,
  openVendorPage,
  sightingOf,
  type VendorRoutes,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

interface Session {
  readonly server: FixtureServer;
  readonly extension: LaunchedExtension;
  readonly routes: VendorRoutes;
  readonly ledgerPage: Page;
  readonly cdp: CDPSession;
  /** The running status of the extension's worker, as CDP reported it, in order. */
  readonly statuses: string[];
}

async function startSession(): Promise<Session> {
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  const routes: VendorRoutes = new Map();
  await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
  const ledgerPage = await extension.openExtensionPage('options.html');
  const cdp = await extension.context.newCDPSession(ledgerPage);
  const statuses: string[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions) {
      if (version.scriptURL.startsWith(`chrome-extension://${extension.extensionId}/`)) {
        statuses.push(version.runningStatus);
      }
    }
  });
  await cdp.send('ServiceWorker.enable');
  return { server, extension, routes, ledgerPage, cdp, statuses };
}

async function withSession(run: (session: Session) => Promise<void>): Promise<void> {
  const session = await startSession();
  try {
    await run(session);
  } finally {
    await session.extension.close();
    await session.server.close();
  }
}

/** Stops every service worker of the profile, as Chrome stops an idle MV3 worker, and waits until it is stopped. */
async function stopWorker(session: Session): Promise<void> {
  await session.cdp.send('ServiceWorker.stopAllWorkers');
  await expect.poll(() => session.statuses.at(-1)).toBe('stopped');
}

const hashes = (ledger: LedgerExport, source: string): string[] =>
  ledger.tables.observations.filter((row) => row.source === source).map((row) => row.contentHash);

const holdsAll = (ledger: LedgerExport, wanted: readonly string[]): boolean => {
  const held = new Set<string>(ledger.tables.observations.map((row) => row.contentHash));
  return wanted.every((hash) => held.has(hash));
};

const healthOf = (ledger: LedgerExport, observer: string) =>
  ledger.tables.adapterHealth.find((report) => report.adapterId === observer);

/** The Calendar first look, a stop, then the next week in the same tab: the creation is stored as a change. */
async function calendarAcrossAStop(session: Session): Promise<void> {
  const before = vendorFixture('gcal', 'synthetic-gcal-week-before.html');
  const tab = await openVendorPage(session.extension.context, session.routes, before);
  const firstLook = await waitForLedger(
    session.ledgerPage,
    (state) => state.tables.calendarSnapshots.length === 1,
  );
  const baseline = firstLook.tables.calendarSnapshots[0]?.snapshot.readAt ?? '';

  await stopWorker(session);
  const created = vendorFixture('gcal', 'synthetic-gcal-week-after-create.html');
  await openVendorPage(session.extension.context, session.routes, created, tab);
  const diff = created.diffs.flatMap((each) =>
    each.observations.map((fact) => expectedObservation(created, fact)),
  );
  const ledger = await waitForLedger(session.ledgerPage, (state) =>
    holdsAll(
      state,
      diff.map((row) => row.contentHash),
    ),
  );
  // The worker woke up for the page's message (it was stopped, then ran again).
  expect(session.statuses.slice(session.statuses.lastIndexOf('stopped'))).toEqual(
    expect.arrayContaining(['stopped', 'running']),
  );
  const wanted = [
    ...before.events.map((event) => sightingOf(before, event).contentHash),
    ...diff.map((row) => row.contentHash),
  ];
  expect(hashes(ledger, 'gcal.event').sort()).toEqual([...wanted].sort());
  expect(healthOf(ledger, 'gcal.event')).toMatchObject({ status: 'OK', reasons: [] });
  const [record] = ledger.tables.calendarSnapshots;
  expect(record?.snapshot.baselineAt).toBe(baseline);
  // Coverage follows changes since the first look, synced at the pass the restarted worker stored.
  const followed = ledger.tables.coverageIntervals.filter(
    (entry) =>
      entry.source === 'gcal.event' &&
      entry.changesSince !== undefined &&
      instantMs(entry.windowStart) !== instantMs(entry.windowEnd),
  );
  expect(followed.map((entry) => [entry.changesSince, entry.lastSyncAt])).toEqual([
    [baseline, record?.snapshot.readAt],
  ]);
}

/** The Sent list, a stop, then a reload: the same rows once each, the head window synced again, OK health. */
async function gmailAcrossAStop(session: Session): Promise<void> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  const rows = sent.observations.map((fact) => expectedObservation(sent, fact).contentHash);
  const tab = await openVendorPage(session.extension.context, session.routes, sent);
  // The pass posts its rows, then its coverage: wait for both, so the stop falls between two whole passes.
  const sentSync = (state: LedgerExport): string | undefined =>
    state.tables.coverageIntervals.find((entry) => entry.source === 'gmail.sent')?.lastSyncAt;
  const first = await waitForLedger(
    session.ledgerPage,
    (state) => holdsAll(state, rows) && sentSync(state) !== undefined,
  );
  const firstSync = sentSync(first) ?? '';

  await stopWorker(session);
  await tab.reload();
  const ledger = await waitForLedger(session.ledgerPage, (state) => {
    const sync = sentSync(state);
    return sync !== undefined && instantMs(sync) > instantMs(firstSync);
  });
  expect(hashes(ledger, 'gmail.sent').sort()).toEqual([...rows].sort());
  expect(ledger.tables.coverageIntervals.filter((entry) => entry.source === 'gmail.sent')).toHaveLength(1);
  expect(healthOf(ledger, 'gmail.sent')).toMatchObject({ status: 'OK', reasons: [] });
}

test.describe('the observer path survives a stopped service worker (qa_tester rule 6)', () => {
  test('Calendar: a stop between two passes; the next week wakes the worker and its change is stored', async () => {
    test.setTimeout(3 * 60_000);
    await withSession(calendarAcrossAStop);
  });

  test('Gmail Sent: a stop between two passes; a reload wakes the worker, rows stay once, coverage moves on', async () => {
    test.setTimeout(3 * 60_000);
    await withSession(gmailAcrossAStop);
  });
});
