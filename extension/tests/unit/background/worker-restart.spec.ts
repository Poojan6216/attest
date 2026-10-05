/**
 * The observer path survives a service worker Chrome stopped mid-pass (qa_tester rule 6; extension_engineer rule 3:
 * no in-memory state that matters; src/background/observer-state.ts; Decisions [2.7]). Added by the Sprint 2 QA review.
 *
 * A restart is modelled as Chrome does it: the ledger (IndexedDB) stays, and the service worker's memory is gone, so
 * the next message reaches handlers with a fresh `createPassState()` over the same database. What the worker held in
 * memory was a Calendar pass's coverage pings (waiting for its snapshot), the observers' own health reports (to clear
 * a DEGRADED it set) and the instants of refused passes. Each loss must err towards less coverage or a DEGRADED that
 * stays one pass longer, never towards more (Hard Rules 5, 6), and the next whole pass must be stored as if nothing
 * happened: no lost row, no row twice, no change turned into a first sighting or back.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountMadeChange } from '../../../src/background/calendar-own';
import { onCalendarSnapshot } from '../../../src/background/calendar-pass';
import { onCoveragePing, onHealth, onObservations } from '../../../src/background/observer-messages';
import { idFromHash } from '../../../src/core/hash';
import { getCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth } from '../../../src/ledger/repo';
import { makeObservation, makePing, pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, event, RANGE, week } from './calendar-fixtures';
import { entryOf, eventOn, markerOf, markers, runPass, weekPing, windows } from './calendar-pass-harness';
import { contextOf, healthOf, pingOf, rowsOf, snapshotOf, tab, type TestContext } from './observer-harness';

// Since v1.12 no Calendar change is known to be the account's own (src/background/calendar-own.ts), so none
// accuses. These scenarios keep the rules a change must also meet once it can be (the live smoke, sprint_2 2.8):
// they run as if the account made every change, but for one case with the shipped predicate.
vi.mock('../../../src/background/calendar-own', () => ({ accountMadeChange: vi.fn(() => true) }));

let db: LedgerDb;
/** The service worker before Chrome stopped it. */
let before: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('worker-restart'));
  before = contextOf(db);
});

afterEach(() => {
  db.close();
  releaseClock();
  vi.mocked(accountMadeChange).mockImplementation(() => true);
});

/** The service worker Chrome starts again: same ledger, empty memory. */
const restarted = (): TestContext => contextOf(db);

const typesStored = async () => (await db.observations.toArray()).map((row) => row.type).sort();
const record = () => getCalendarRecord(db, { observerId: 'gcal.event', accountHash: ACCOUNT, range: RANGE });

describe('Calendar: the worker stops between a pass’s coverage ping and its snapshot', () => {
  it('the snapshot still stores its rows and record, the held window is lost, and the next pass is whole', async () => {
    expect(await runPass(before, week([event('a')], { readAt: at(0) }))).toEqual({ ok: true });
    const b = eventOn('b', '2026-10-07');
    // Pass at(1): its ping is held by the worker that is then stopped.
    expect(await onCoveragePing(before, pingOf(weekPing(at(1))), tab())).toEqual({ ok: true });
    const after = restarted();
    const snapshot = week([event('a'), b], { readAt: at(1) });
    expect(await onCalendarSnapshot(after, snapshotOf(snapshot, ACCOUNT), tab())).toEqual({ ok: true });
    // The change is stored as a change (no marker), the base moves on, and no window claims the lost pass.
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.created']);
    expect(await markers(db)).toEqual([markerOf(event('a'), at(0))]);
    expect((await record())?.snapshot.readAt).toBe(at(1));
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(0))), changesSince: at(0) }]);
    // The next whole pass, to the restarted worker, records its window, still following changes since the first look.
    expect(await runPass(after, week([event('a'), b], { readAt: at(2) }))).toEqual({ ok: true });
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.created']);
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(2))), changesSince: at(0) }]);
    expect(await getAdapterHealth(db, 'gcal.event')).toBeUndefined();
  });

  it('with the shipped predicate (v1.12): the change after the restart is stored with its marker, never as a change', async () => {
    vi.mocked(accountMadeChange).mockImplementation(() => false);
    expect(await runPass(before, week([event('a')], { readAt: at(0) }))).toEqual({ ok: true });
    const b = eventOn('b', '2026-10-07');
    expect(await onCoveragePing(before, pingOf(weekPing(at(1))), tab())).toEqual({ ok: true });
    const after = restarted();
    const snapshot = week([event('a'), b], { readAt: at(1) });
    expect(await onCalendarSnapshot(after, snapshotOf(snapshot, ACCOUNT), tab())).toEqual({ ok: true });
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.created']);
    expect(await markers(db)).toEqual([markerOf(event('a'), at(0)), markerOf(b, at(1))]);
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(0))), changesSince: at(0) }]);
  });

  it('a pass cut off at its ping (the snapshot never sent) leaves the base, and the next pass reports the change', async () => {
    expect(await runPass(before, week([event('a')], { readAt: at(0) }))).toEqual({ ok: true });
    expect(await onCoveragePing(before, pingOf(weekPing(at(1))), tab())).toEqual({ ok: true });
    const after = restarted();
    const b = eventOn('b', '2026-10-07');
    expect(await runPass(after, week([event('a'), b], { readAt: at(2) }))).toEqual({ ok: true });
    const created = (await db.observations.toArray()).filter((row) => row.type === 'calendar.created');
    expect(created.map((row) => row.observedAt).sort()).toEqual([at(0), at(2)]);
    expect(await markers(db)).toEqual([markerOf(event('a'), at(0))]);
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(2))), changesSince: at(0) }]);
  });
});

describe('Calendar: what a pass leaves for the next one is in the ledger, not in the worker', () => {
  it('a deletion awaiting its confirming pass is kept in the ledger, so the restarted worker confirms it', async () => {
    const b = eventOn('b', '2026-10-07');
    expect(await runPass(before, week([event('a'), b], { readAt: at(0) }))).toEqual({ ok: true });
    expect(await runPass(before, week([event('a')], { readAt: at(1) }))).toEqual({ ok: true });
    expect((await record())?.pending.map((absence) => absence.since)).toEqual([at(1)]);
    const after = restarted();
    expect(await runPass(after, week([event('a')], { readAt: at(2) }))).toEqual({ ok: true });
    const deleted = (await db.observations.toArray()).filter((row) => row.type === 'calendar.deleted');
    // First seen at the first absence, as without a restart (src/background/calendar-step.ts).
    expect(deleted.map((row) => row.observedAt)).toEqual([at(1)]);
    expect((await record())?.pending).toEqual([]);
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(2))), changesSince: at(0) }]);
  });

  it('a DEGRADED the old worker set stays until a whole pass reaches the new one, which clears it', async () => {
    expect(await runPass(before, week([event('a')], { readAt: at(0) }))).toEqual({ ok: true });
    // A ping that names another account than its own pass's snapshot: refused, DEGRADED.
    const other = sha(77);
    expect(await onCoveragePing(before, pingOf(weekPing(at(1), { accountHash: other })), tab())).toEqual({
      ok: true,
    });
    expect(
      await onCalendarSnapshot(before, snapshotOf(week([event('a')], { readAt: at(1) }), ACCOUNT), tab()),
    ).toEqual({ ok: false, code: 'invalid_input' });
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ status: 'DEGRADED' });
    const after = restarted();
    expect(await onHealth(after, healthOf('gcal.event', at(2)))).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ status: 'DEGRADED' });
    expect(await runPass(after, week([event('a')], { readAt: at(2) }))).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ status: 'OK', checkedAt: at(2) });
  });
});

describe('Gmail: the worker stops between a pass’s rows and its coverage', () => {
  const SIGHTED = '2026-10-01T10:20:00-04:00';
  const sentPing = (lastSyncAt: string) =>
    makePing({
      observerId: 'gmail.sent',
      lastSyncAt,
      windowStart: '2026-10-01T09:00:00-04:00',
      windowEnd: lastSyncAt,
    });

  it('the ping reaches the new worker and is recorded once; the same rows sent again are stored once', async () => {
    const row = makeObservation({ observedAt: SIGHTED });
    expect(await onHealth(before, healthOf('gmail.sent', SIGHTED))).toEqual({ ok: true });
    expect(await onObservations(before, rowsOf('gmail.sent', [row]))).toEqual({ ok: true });
    const after = restarted();
    expect(await onCoveragePing(after, pingOf(sentPing(SIGHTED)), tab())).toEqual({ ok: true });
    expect(await db.coverageIntervals.count()).toBe(1);
    // The next pass re-posts every row (base.ts: the tab keeps no record of what it sent): one stored row.
    const LATER = '2026-10-01T10:25:00-04:00';
    expect(await onObservations(after, rowsOf('gmail.sent', [{ ...row, observedAt: LATER }]))).toEqual({
      ok: true,
    });
    expect(await onCoveragePing(after, pingOf(sentPing(LATER)), tab())).toEqual({ ok: true });
    const stored = await db.observations.toArray();
    expect(stored.map((each) => each.id)).toEqual([row.id]);
    expect(stored[0]?.sightedAt ?? stored[0]?.observedAt).toBe(SIGHTED);
    expect(await db.coverageIntervals.count()).toBe(1);
  });

  it('a pass the old worker refused stays DEGRADED across the restart, until a clean pass is accepted', async () => {
    const contentHash = sha(4242);
    const forged = {
      id: idFromHash(contentHash),
      source: 'gmail.sent' as const,
      type: 'email.sent' as const,
      merchant: 'Acme Store',
      occurredAt: '2026-10-01T10:15:00-04:00',
      observedAt: SIGHTED,
      contentHash,
    };
    expect(await onObservations(before, rowsOf('gmail.sent', [forged]))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    const after = restarted();
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'DEGRADED' });
    const LATER = '2026-10-01T10:25:00-04:00';
    expect(await onHealth(after, healthOf('gmail.sent', LATER))).toEqual({ ok: true });
    expect(
      await onObservations(after, rowsOf('gmail.sent', [makeObservation({ observedAt: LATER })])),
    ).toEqual({
      ok: true,
    });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: LATER });
    expect(await db.observations.count()).toBe(1);
  });
});
