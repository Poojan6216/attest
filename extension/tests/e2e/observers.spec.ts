/**
 * Sprint 2.7 (Read: agents/extension_engineer.md): the observers' content scripts write the user's Gmail and
 * Calendar pages to the ledger, end to end, in the shipped build.
 *
 * The labelled fixtures are opened at the vendors' own addresses (./support/vendor-pages.ts: Playwright routing, no
 * network, no test build), so the real content scripts run the real observers, post over the real bus, and the
 * service worker stores through the real ledger. The ledger is then read back through the user's own export.
 *  - The Sent list and a run of Calendar weeks (before and after a creation, an edit and a deletion) export as
 *    exactly their labelled observations, with only allowlisted fields, no seeded secret, OK health, coverage
 *    that follows the rows, and a first-look marker for each event the first look found (Hard Rules 2, 5, 7).
 *  - A Sent list of mails composed as drafts first exports each as its row, and a conversation as none, with the window
 *    starting a minute after the newest conversation (sprint_2 2.10, live smoke finding 1; Hard Rule 5).
 *  - Forged and out-of-order observer messages, sent from a vendor tab's content-script world since the service worker
 *    checks which site an observer message comes from, are ./observer-forged.spec.ts.
 *  - A Calendar event sighted before a `calendar.created` claim but written after a grading batch is stored with its
 *    sighting as `sightedAt` and is not that claim's evidence (SIM-2; docs/grading.md §4.1; Hard Rule 5).
 */
import { expect, type Page, test } from '@playwright/test';

import { candidates, createMemoryIndex } from '../../src/core/candidates';
import { idFromHash } from '../../src/core/hash';
import { instantMs } from '../../src/core/normalize';
import { Claim } from '../../src/core/schema';
import type { LedgerExport } from '../../src/ledger/export';
import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';
import type { LabelledFixture } from '../unit/fixtures/fixture-labels';
import { launchExtension, type LaunchedExtension } from './support/extension';
import { findLeaks, loadSeeds } from './support/leaks';
import { installRouteGuard } from './support/network-guard';
import {
  allowedFields,
  expectedObservation,
  FIXTURE_TIME_ZONE,
  openVendorPage,
  POLICY_DOCUMENT,
  readLedger,
  sightingOf,
  type VendorRoutes,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

interface Session {
  readonly server: FixtureServer;
  readonly extension: LaunchedExtension;
  readonly routes: VendorRoutes;
  /** An extension page the test asks the ledger from. */
  readonly ledgerPage: Page;
}

async function startSession(): Promise<Session> {
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  const routes: VendorRoutes = new Map();
  await installRouteGuard(extension.context, { fixtureOrigin: server.origin, routedFixtures: routes });
  const ledgerPage = await extension.openExtensionPage('options.html');
  return { server, extension, routes, ledgerPage };
}

async function endSession(session: Session): Promise<void> {
  await session.extension.close();
  await session.server.close();
}

async function withSession(run: (session: Session) => Promise<void>): Promise<void> {
  const session = await startSession();
  try {
    await run(session);
  } finally {
    await endSession(session);
  }
}

const hashesOf = (ledger: LedgerExport): Set<string> =>
  new Set(ledger.tables.observations.map((observation) => observation.contentHash));

const holdsAll = (ledger: LedgerExport, hashes: readonly string[]): boolean => {
  const held = hashesOf(ledger);
  return hashes.every((hash) => held.has(hash));
};

const health = (ledger: LedgerExport, observer: string) =>
  ledger.tables.adapterHealth.find((report) => report.adapterId === observer);

/** The labelled diff of `file` against the fixture before it, as stored observations. */
function diffRows(file: string): string[] {
  const fixture = vendorFixture('gcal', file);
  return fixture.diffs.flatMap((diff) =>
    diff.observations.map((fact) => expectedObservation(fixture, fact).contentHash),
  );
}

/** Opens each Calendar week in one tab, in turn, waiting until the service worker stored each pass's snapshot. */
async function walkCalendar(session: Session, files: readonly string[]): Promise<void> {
  let tab: Page | undefined;
  let readAt: string | undefined;
  for (const file of files) {
    tab = await openVendorPage(session.extension.context, session.routes, vendorFixture('gcal', file), tab);
    const ledger = await waitForLedger(session.ledgerPage, (state) => {
      const record = state.tables.calendarSnapshots[0];
      return record !== undefined && record.snapshot.readAt !== readAt;
    });
    readAt = ledger.tables.calendarSnapshots[0]?.snapshot.readAt;
  }
}

/** Every observation holds only its source's allowlisted fields and the derived fields every row carries. */
function expectAllowlisted(ledger: LedgerExport): void {
  for (const observation of ledger.tables.observations) {
    const allowed = allowedFields(observation.source);
    expect(
      Object.keys(observation).filter((key) => !allowed.has(key)),
      observation.id,
    ).toEqual([]);
  }
}

/** The Sent list and a run of Calendar weeks export as exactly their labelled rows (see the module comment). */
async function exportsLabelledRows(session: Session): Promise<void> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  const sentRows = sent.observations.map((fact) => expectedObservation(sent, fact).contentHash);
  await openVendorPage(session.extension.context, session.routes, sent);
  await waitForLedger(session.ledgerPage, (ledger) => holdsAll(ledger, sentRows));

  const weeks = ['before', 'after-create', 'unchanged', 'after-edit', 'after-delete', 'after-delete'];
  await walkCalendar(
    session,
    weeks.map((week) => `synthetic-gcal-week-${week}.html`),
  );
  const before = vendorFixture('gcal', 'synthetic-gcal-week-before.html');
  const calendarRows = [
    ...before.events.map((event) => sightingOf(before, event).contentHash),
    ...diffRows('synthetic-gcal-week-after-create.html'),
    ...diffRows('synthetic-gcal-week-after-edit.html'),
    ...diffRows('synthetic-gcal-week-after-delete.html'),
  ];
  const ledger = await waitForLedger(session.ledgerPage, (state) => holdsAll(state, calendarRows));

  const bySource = (source: string) =>
    ledger.tables.observations.filter((row) => row.source === source).map((row) => row.contentHash);
  expect(new Set(bySource('gmail.sent'))).toEqual(new Set(sentRows));
  expect(new Set(bySource('gcal.event'))).toEqual(new Set(calendarRows));
  expect(bySource('gmail.receipt')).toEqual([]);
  expectEditIsNoCreation(ledger);
  expectAllowlisted(ledger);
  expect(findLeaks('ledger-export', ledger, loadSeeds())).toEqual([]);
  for (const observer of ['gmail.sent', 'gcal.event']) {
    expect(health(ledger, observer), observer).toMatchObject({ status: 'OK', reasons: [] });
  }
  // No conversation was opened: the receipt observer had nothing to read, neither OK nor broken (sprint_2 2.11).
  expect(health(ledger, 'gmail.receipt')).toMatchObject({ status: 'IDLE', reasons: ['no_conversation'] });
  expectCoverage(ledger, sent, vendorFixture('gcal', 'synthetic-gcal-week-after-delete.html'));
  expectMarkers(ledger, before);
}

/** A Sent list with mails composed as drafts first exports exactly its labelled rows and window (module comment). */
async function exportsDraftFirstRows(session: Session): Promise<void> {
  const page = vendorFixture('gmail', 'synthetic-sent-draft-first.html');
  const rows = page.observations.map((fact) => expectedObservation(page, fact).contentHash);
  await openVendorPage(session.extension.context, session.routes, page);
  // The pass posts its coverage after its rows, so once the window is stored every row of the pass is too.
  const ledger = await waitForLedger(
    session.ledgerPage,
    (state) =>
      holdsAll(state, rows) && state.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
  );
  const sent = ledger.tables.observations.filter((row) => row.source === 'gmail.sent');
  expect(new Set(sent.map((row) => row.contentHash))).toEqual(new Set(rows));
  expect(health(ledger, 'gmail.sent')).toMatchObject({ status: 'OK', reasons: [] });
  const windows = ledger.tables.coverageIntervals.filter((entry) => entry.source === 'gmail.sent');
  expect(windows.map((entry) => entry.windowStart)).toEqual([page.coverage[0]?.windowStart]);
  expect(windows[0]?.windowEnd).toBe(windows[0]?.lastSyncAt);
}

/** A grading batch between a pass's sighting and its write. */
async function sightedBeforeBatch(session: Session): Promise<void> {
  // The ledger is open (an export opens it); then a grading batch is recorded two minutes ahead, so every row
  // the next pass sights is written after that batch (Sprint 3.6 records batches; Sprint 2 has none yet).
  await readLedger(session.ledgerPage);
  const batchMs = Date.now() + 120_000;
  const worker = await session.extension.serviceWorker();
  await worker.evaluate(recordBatchInstant, new Date(batchMs).toISOString());

  const before = vendorFixture('gcal', 'synthetic-gcal-week-before.html');
  const rows = before.events.map((event) => sightingOf(before, event).contentHash);
  await openVendorPage(session.extension.context, session.routes, before);
  const ledger = await waitForLedger(session.ledgerPage, (state) => holdsAll(state, rows));
  await expectEvidenceExcluded(ledger, before, batchMs);
}

test.describe('the observers write Gmail and Calendar to the ledger (sprint_2 2.7)', () => {
  test('the Sent and Calendar fixtures export as their labelled observations, allowlisted fields only', async () => {
    test.setTimeout(4 * 60_000);
    await withSession(exportsLabelledRows);
  });

  test('a mail composed as a draft first is a row, and a conversation is none (sprint_2 2.10)', async () => {
    test.setTimeout(2 * 60_000);
    await withSession(exportsDraftFirstRows);
  });

  test('a Calendar event sighted before a calendar.created claim but written after a batch is not its evidence', async () => {
    test.setTimeout(2 * 60_000);
    await withSession(sightedBeforeBatch);
  });
});

/** The labelled edit is one `calendar.updated` row: its new state never comes back as a `calendar.created`. */
function expectEditIsNoCreation(ledger: LedgerExport): void {
  const edit = vendorFixture('gcal', 'synthetic-gcal-week-after-edit.html');
  for (const diff of edit.diffs) {
    for (const fact of diff.observations) {
      const asCreated = expectedObservation(edit, { ...fact, type: 'calendar.created' }).contentHash;
      expect(hashesOf(ledger).has(asCreated)).toBe(false);
    }
  }
}

type Interval = LedgerExport['tables']['coverageIntervals'][number];

/** A first-look marker (src/ledger/first-look.ts): a Calendar point that began comparing at its own sync. */
const isMarker = (entry: Interval): boolean =>
  entry.source === 'gcal.event' &&
  entry.changesSince !== undefined &&
  instantMs(entry.windowStart) === instantMs(entry.windowEnd) &&
  instantMs(entry.changesSince) === instantMs(entry.lastSyncAt);

/**
 * Every Calendar row is stored with its first-look marker: a point at the event's start whose changesSince is the
 * row's first sighting (docs/grading.md §3, §7 v1.12; Hard Rule 7). The first look's sightings have one, and so does
 * every change the later weeks report, since Attest cannot yet tell a change the account made from one other people
 * made: no Calendar row accuses an agent, and no marker is left without its row.
 */
function expectMarkers(ledger: LedgerExport, before: LabelledFixture): void {
  const markers = ledger.tables.coverageIntervals.filter(isMarker);
  const marked = new Set(
    markers.map((entry) => `${instantMs(entry.windowStart)}@${instantMs(entry.lastSyncAt)}`),
  );
  const rows = ledger.tables.observations.filter((row) => row.source === 'gcal.event');
  expect(rows.length).toBeGreaterThan(before.events.length);
  for (const row of rows) {
    const firstSeen = instantMs(row.sightedAt ?? row.observedAt);
    expect(marked.has(`${instantMs(row.occurredAt)}@${firstSeen}`), row.subjectHint).toBe(true);
  }
  expect(markers.length).toBeLessThanOrEqual(rows.length);
}

/** Coverage follows the rows: the Sent head up to its sync, the Calendar week with its changes followed. */
function expectCoverage(ledger: LedgerExport, sent: LabelledFixture, week: LabelledFixture): void {
  const intervals = ledger.tables.coverageIntervals;
  const sentWindow = sent.coverage[0];
  const sentInterval = intervals.find((entry) => entry.source === 'gmail.sent');
  expect(sentInterval?.windowStart).toBe(sentWindow?.windowStart);
  expect(sentInterval?.windowEnd).toBe(sentInterval?.lastSyncAt);
  const weekWindow = week.coverage[0];
  const followed = intervals.filter(
    (entry) => entry.source === 'gcal.event' && entry.changesSince !== undefined && !isMarker(entry),
  );
  expect(followed).toHaveLength(1);
  const [calendar] = followed;
  expect([calendar?.windowStart, calendar?.windowEnd]).toEqual([
    weekWindow?.windowStart,
    weekWindow?.windowEnd,
  ]);
  const [record] = ledger.tables.calendarSnapshots;
  // The chain began at the first look and was never broken; the deletion was confirmed, so nothing is pending.
  expect(calendar?.changesSince).toBe(record?.snapshot.baselineAt);
  expect(calendar?.lastSyncAt).toBe(record?.snapshot.readAt);
  expect(record?.pending).toEqual([]);
}

/** The sighting is kept as `sightedAt`, stored after the batch, and the first-seen rule reads the sighting. */
async function expectEvidenceExcluded(
  ledger: LedgerExport,
  before: LabelledFixture,
  batchMs: number,
): Promise<void> {
  const [event] = before.events;
  if (event === undefined) throw new Error('the week has no event');
  const row = ledger.tables.observations.find(
    (each) => each.contentHash === sightingOf(before, event).contentHash,
  );
  if (row?.sightedAt === undefined) throw new Error('the row kept no sighting');
  const sightedMs = instantMs(row.sightedAt);
  expect(sightedMs).toBeLessThan(batchMs);
  expect(instantMs(row.observedAt)).toBe(batchMs + 1);
  // "Created it" three minutes after the sighting: first-seen bound about a minute after it, before the batch.
  const claimedMs = sightedMs + 3 * 60_000;
  const rawHash = 'cd'.repeat(32);
  const claim = Claim.parse({
    id: idFromHash(rawHash),
    agent: 'muse',
    type: 'calendar.created',
    subjectHint: event.subjectHint,
    claimedAt: new Date(claimedMs).toISOString(),
    claimedAtPrecision: 'minute',
    targetAt: event.occurredAt,
    observedAt: new Date(claimedMs + 60_000).toISOString(),
    sourceKind: 'activity_view',
    extractor: { id: 'e2e', version: '1', confidence: 1 },
    rawHash,
  });
  const found = await candidates(claim, createMemoryIndex(ledger.tables.observations, 60), POLICY_DOCUMENT);
  expect(found.map((each) => each.id)).not.toContain(row.id);
  // Control: read by its stored instant alone (after the batch), the same row would have been that claim's evidence.
  const unsighted = { ...row, sightedAt: undefined };
  const control = await candidates(claim, createMemoryIndex([unsighted], 60), POLICY_DOCUMENT);
  expect(control.map((each) => each.id)).toContain(row.id);
}

/** Runs in the service worker: records a batch instant in the ledger's `meta` store, as a grading batch does. */
async function recordBatchInstant(evaluatedAt: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('attest');
    open.onerror = () => {
      reject(new Error('ledger open failed'));
    };
    open.onsuccess = () => {
      const tx = open.result.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'lastEvaluatedAt', value: evaluatedAt });
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => {
        reject(new Error('ledger write failed'));
      };
    };
  });
}
