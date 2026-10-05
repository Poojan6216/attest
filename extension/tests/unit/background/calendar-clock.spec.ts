/**
 * A clock that went back never lets the ledger vouch for what it did not see (src/ledger/clock-guard.ts,
 * src/background/calendar-pass.ts step 2, src/background/observer-messages.ts; Decisions [2.7] wave E; Hard Rules 4,
 * 5, 6, 7). The Calendar simulator's probes, kept, each through the real handlers and ledger:
 *  - CAL-SIM-2: a pass stored while the clock was five hours ahead is merged into the chain that began before it; the
 *    clock comes back, and the merged interval would read as following the calendar over hours its passes never saw;
 *  - CAL-SIM-3: the clock steps back for good after a claim; the chain that restarts after the step would follow
 *    changes from an instant below the claim, and vouch for a deletion it never compared;
 *  - CAL-SIM-7: a row first seen while the clock was ahead refused every pass of its range (`late_sighting`) until
 *    real time caught up;
 *  - a pass, ping or row read after the service worker's clock is not stored (`clock_behind`), and a Gmail interval
 *    stored in the future is gone before the next Gmail ping could be merged into it.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountMadeChange } from '../../../src/background/calendar-own';
import { onCalendarSnapshot } from '../../../src/background/calendar-pass';
import { onCoveragePing, onObservations } from '../../../src/background/observer-messages';
import { coveredObservations, visibleAt } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { instantMs } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { IsoTs, type ObserverCoverage } from '../../../src/core/schema';
import { getCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import { CLOCK_FLOOR_AT } from '../../../src/ledger/clock-guard';
import { coverageFor, readInterval } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { isFirstLookMarker } from '../../../src/ledger/first-look';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth, recordBatchInstant, upsertClaim } from '../../../src/ledger/repo';
import { Observation } from '../../../src/ledger/types';
import { captureLogs, makeClaim, pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, RANGE, week } from './calendar-fixtures';
import { eventOn, markerOf, rowOf, runPass, weekPing } from './calendar-pass-harness';
import { contextOf, pingOf, rowsOf, snapshotOf, tab, type TestContext } from './observer-harness';

// The shipped predicate (v1.12: no Calendar change is known to be the account's own, src/background/calendar-own.ts),
// switched on where a case checks the attribution rules a change must also meet once one can be (sprint_2 2.8).
vi.mock('../../../src/background/calendar-own', () => ({ accountMadeChange: vi.fn(() => false) }));

let db: LedgerDb;
let ctx: TestContext;
/** The service worker's clock (`ctx.now()`), moved by each test. */
let clock: IsoTs;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-clock'));
  clock = at(0);
  ctx = contextOf(db, { now: () => clock });
});

afterEach(() => {
  db.close();
  releaseClock();
  vi.mocked(accountMadeChange).mockImplementation(() => false);
});

const standup = eventOn('e', '2026-10-06', 10, { subjectHint: 'Standup' });
const vendor = eventOn('g', '2026-10-07', 10, { subjectHint: 'Vendor call' });
const dentist = eventOn('f', '2026-10-08', 10, { subjectHint: 'Dentist' });

/** A whole pass of the week read at `readAt`, with the worker's clock at `now` (the same instant by default). */
async function passAt(readAt: IsoTs, events: Parameters<typeof week>[0], now: IsoTs = readAt) {
  clock = now;
  return runPass(ctx, week(events, { readAt }));
}

const record = () => getCalendarRecord(db, { observerId: 'gcal.event', accountHash: ACCOUNT, range: RANGE });

async function stored(): Promise<ObserverCoverage[]> {
  return (await db.coverageIntervals.toArray()).flatMap((row) => {
    const placed = readInterval(row);
    return placed === undefined ? [] : [placed.entry];
  });
}

/**
 * The Calendar windows a batch at `evaluatedAt` would read as following every change over `[fromAt, toAt]` on Wed 7
 * Oct at 10:00 (a change claim's span, docs/grading.md §6.1): `changesSince` at or before its start, synced at or
 * after its end. Markers follow nothing.
 */
async function followedOver(evaluatedAt: IsoTs, fromAt: IsoTs, toAt: IsoTs): Promise<ObserverCoverage[]> {
  const day = Date.parse(vendor.occurredAt);
  const window = { fromMs: day, toMs: day + 3_600_000 };
  const coverage = await coverageFor(db, { type: 'calendar.deleted', window, evaluatedAt }, DEFAULT_POLICY);
  return coverage.observers.filter(
    (entry) =>
      entry.source === 'gcal.event' &&
      !isFirstLookMarker(entry) &&
      entry.changesSince !== undefined &&
      instantMs(entry.changesSince) <= instantMs(fromAt) &&
      instantMs(entry.lastSyncAt) >= instantMs(toAt) &&
      instantMs(entry.windowStart) <= day &&
      instantMs(entry.windowEnd) >= day,
  );
}

/** The subject hints of the orphan candidates of a batch at `evaluatedAt` over the week. */
async function orphans(evaluatedAt: IsoTs): Promise<string[]> {
  const window = {
    fromMs: Date.parse('2026-10-04T00:00:00-04:00'),
    toMs: Date.parse('2026-10-11T00:00:00-04:00'),
  };
  const coverage = await coverageFor(db, { type: 'calendar.created', window, evaluatedAt }, DEFAULT_POLICY);
  const rows = readRows('observations', Observation, await db.observations.toArray());
  const index = visibleAt(createMemoryIndex(rows, 15), instantMs(evaluatedAt));
  const found = await coveredObservations(index, coverage, DEFAULT_POLICY);
  return found.map(({ observation }) => observation.subjectHint ?? '').sort();
}

const firstSeen = async (subject: string): Promise<string | undefined> => {
  const rows = readRows('observations', Observation, await db.observations.toArray());
  const row = rows.find((each) => each.subjectHint === subject);
  return row === undefined ? undefined : (row.sightedAt ?? row.observedAt);
};

describe('CAL-SIM-2: a clock that jumped forward, then back', () => {
  it('the interval stored in the future is deleted, never vouching for the hours it did not see', async () => {
    expect(await passAt(at(0), [standup, vendor])).toEqual({ ok: true });
    expect(await passAt(at(2), [standup, vendor])).toEqual({ ok: true });
    // Real 12:04: the clock reads 17:05 for a few minutes, and the tab re-renders.
    expect(await passAt(at(305), [standup, vendor])).toEqual({ ok: true });
    // The clock comes back. 14:05 the week is read again: the ledger repairs before it stores the pass.
    const { records, restore } = captureLogs();
    expect(await passAt(at(125), [standup, vendor])).toEqual({ ok: true });
    restore();
    // The Calendar parts of the repair (the guard also counts the health rows it reset: SEC-4, not this test's).
    const repair = records.find((each) => each.event === 'ledger.clock_regressed');
    expect(repair?.fields).toMatchObject({ intervals: 1, pings: 1, records: 1, rows: 0 });
    expect((await stored()).every((entry) => instantMs(entry.lastSyncAt) <= instantMs(at(125)))).toBe(true);
    expect((await record())?.snapshot.readAt).toBe(at(125));
    // 14:10 the agent deletes "Vendor call" and says so; the week is read on, to past the jumped instant.
    for (const readAt of [at(135), at(310), at(320)]) {
      expect(await passAt(readAt, [standup])).toEqual({ ok: true });
    }
    // No window followed changes over the claim's change span: the deletion is never vouched for by the jump.
    expect(await followedOver(at(330), at(128), at(161))).toEqual([]);
    // The deletion was seen (first absence 14:15, confirmed 17:10), and it is the claim's evidence, not a guess.
    expect(await firstSeen('Vendor call')).toBe(at(0));
    const deleted = (await db.observations.toArray()).find((row) => row.type === 'calendar.deleted');
    expect(deleted?.observedAt).toBe(at(135));
    // The restarted chain follows changes only from the jumped instant on: the floor.
    expect((await db.meta.get(CLOCK_FLOOR_AT))?.value).toBe(at(305));
    expect((await stored()).filter((entry) => !isFirstLookMarker(entry)).at(-1)).toMatchObject({
      changesSince: at(305),
      lastSyncAt: at(320),
    });
  });
});

describe('CAL-SIM-7: a row first seen while the clock was ahead', () => {
  it('no longer locks its range out: it is forgotten and derived again, first seen now, with its marker', async () => {
    expect(await passAt(at(0), [standup])).toEqual({ ok: true });
    expect(await passAt(at(2), [standup])).toEqual({ ok: true });
    expect(await passAt(at(305), [standup, dentist])).toEqual({ ok: true });
    expect(await firstSeen('Dentist')).toBe(at(305));
    // Back to 12:10: the pass is stored, not refused late_sighting, and the observer stays healthy.
    expect(await passAt(at(130), [standup, dentist])).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gcal.event')).toBeUndefined();
    expect(await firstSeen('Dentist')).toBe(at(130));
    expect((await stored()).filter(isFirstLookMarker)).toContainEqual(
      markerOf(dentist, at(130), { accountHash: ACCOUNT, allCalendars: false }),
    );
    // A real change seen later, compared with a fresh base, is stored as the change it is (a calendar.created first
    // seen then), with its marker: since v1.12 no Calendar change accuses (Decisions [2.close]). Nor, ever, does the
    // event already there.
    expect(await passAt(at(311), [standup, dentist])).toEqual({ ok: true });
    expect(await passAt(at(312), [standup, dentist, vendor])).toEqual({ ok: true });
    expect(await firstSeen('Vendor call')).toBe(at(312));
    expect((await stored()).filter(isFirstLookMarker)).toContainEqual(
      markerOf(vendor, at(312), { accountHash: ACCOUNT, allCalendars: false }),
    );
    expect(await orphans(at(330))).toEqual([]);
  });

  it('once the account’s own changes can be told (2.8), a real change seen later still accuses; the event there never does', async () => {
    vi.mocked(accountMadeChange).mockImplementation(() => true);
    expect(await passAt(at(0), [standup])).toEqual({ ok: true });
    expect(await passAt(at(2), [standup])).toEqual({ ok: true });
    expect(await passAt(at(305), [standup, dentist])).toEqual({ ok: true });
    expect(await passAt(at(130), [standup, dentist])).toEqual({ ok: true });
    expect(await firstSeen('Dentist')).toBe(at(130));
    expect(await passAt(at(311), [standup, dentist])).toEqual({ ok: true });
    expect(await passAt(at(312), [standup, dentist, vendor])).toEqual({ ok: true });
    expect(await orphans(at(330))).toEqual(['Vendor call']);
  });

  it('a row a batch read stays as stored; its earlier re-sighting changes nothing, and it never accuses', async () => {
    // With the account's own changes told apart (2.8), so the clock floor is what keeps the row from accusing.
    vi.mocked(accountMadeChange).mockImplementation(() => true);
    expect(await passAt(at(0), [standup])).toEqual({ ok: true });
    expect(await passAt(at(2), [standup])).toEqual({ ok: true });
    expect(await passAt(at(303), [standup, dentist])).toEqual({ ok: true });
    // A batch ran while the clock was ahead and read "Dentist" (first seen in the future, as a change).
    await recordBatchInstant(db, at(306));
    expect(await passAt(at(130), [standup, dentist])).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'gcal.event')).toBeUndefined();
    expect(await firstSeen('Dentist')).toBe(at(303));
    for (const readAt of [at(310), at(311)]) {
      expect(await passAt(readAt, [standup, dentist])).toEqual({ ok: true });
    }
    // The chain restarted after the clock went back follows changes from the jumped instant only, so the row first
    // seen at that instant is never read as a change it followed.
    expect(await orphans(at(330))).toEqual([]);
  });
});

describe('CAL-SIM-7 on a page with no account', () => {
  it('its row first seen while the clock was ahead is forgotten before the page posts it again', async () => {
    clock = at(305);
    expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(dentist, at(305))]))).toEqual({ ok: true });
    clock = at(130);
    expect(await onObservations(ctx, rowsOf('gcal.event', [rowOf(dentist, at(130))]))).toEqual({ ok: true });
    expect(await firstSeen('Dentist')).toBe(at(130));
    expect((await stored()).filter(isFirstLookMarker)).toEqual([markerOf(dentist, at(130), {})]);
  });
});

describe('CAL-SIM-3: a clock that stepped back for good', () => {
  it('the chain that restarts after the step never follows changes from before the latest instant stamped', async () => {
    expect(await passAt(at(0), [standup, vendor])).toEqual({ ok: true });
    expect(await passAt(at(230), [standup, vendor])).toEqual({ ok: true });
    // 15:56 the agent deletes "Vendor call" and says so; the claim is stored at once.
    clock = at(236);
    const claim = makeClaim({
      type: 'calendar.deleted',
      subjectHint: 'Vendor call',
      claimedAt: at(236),
      targetAt: vendor.occurredAt,
      observedAt: at(236),
    });
    await upsertClaim(db, { ...claim, counterparty: undefined });
    // Real 16:00: the clock steps back 110 minutes and stays there; the tab re-renders every few minutes.
    for (const readAt of [135, 160, 200, 240, 260, 270, 280].map(at)) {
      expect(await passAt(readAt, [standup])).toEqual({ ok: true });
    }
    // The claim's change span is [15:54, 16:27]: no window may say it followed it, since none compared across it.
    expect(await followedOver(at(285), at(234), at(267))).toEqual([]);
    expect((await db.meta.get(CLOCK_FLOOR_AT))?.value).toBe(at(236));
    const windows = (await stored()).filter((entry) => !isFirstLookMarker(entry));
    expect(windows.map((entry) => entry.changesSince ?? null)).toEqual([null, at(236)]);
  });
});

describe('a message read after the service worker clock (the clock went back since) is not stored', () => {
  it('a Calendar pass: answered clock_behind, nothing stored, not DEGRADED; one read at the clock is stored', async () => {
    clock = IsoTs.parse('2026-10-03T12:29:59.999-04:00');
    const snapshot = week([standup], { readAt: at(30) });
    const { records, restore } = captureLogs();
    expect(await onCoveragePing(ctx, pingOf(weekPing(at(30))), tab())).toEqual({
      ok: false,
      code: 'clock_behind',
    });
    expect(await onCalendarSnapshot(ctx, snapshotOf(snapshot, ACCOUNT), tab())).toEqual({
      ok: false,
      code: 'clock_behind',
    });
    restore();
    expect(records.map((each) => [each.event, each.fields])).toEqual([
      ['observer.clock_behind', { observer: 'gcal.event', type: 'coverage.ping' }],
      ['observer.clock_behind', { observer: 'gcal.event', type: 'calendar.snapshot' }],
    ]);
    expect(await db.observations.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await db.calendarSnapshots.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gcal.event')).toBeUndefined();
    expect(await passAt(at(30), [standup], at(30))).toEqual({ ok: true });
  });

  it('a ping, and the rows of a page with no account', async () => {
    clock = at(10);
    const ping = { ...sentPing(at(11)) };
    expect(await onCoveragePing(ctx, pingOf(ping), tabOf())).toEqual({ ok: false, code: 'clock_behind' });
    const rows = rowsOf('gcal.event', [rowOf(standup, at(11))]);
    expect(await onObservations(ctx, rows)).toEqual({ ok: false, code: 'clock_behind' });
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await db.observations.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gcal.event')).toBeUndefined();
  });
});

describe('Gmail coverage stored while the clock was ahead', () => {
  it('is gone before the next ping, which is never merged into it', async () => {
    clock = at(305);
    expect(await onCoveragePing(ctx, pingOf(sentPing(at(305))), tabOf())).toEqual({ ok: true });
    clock = at(130);
    expect(await onCoveragePing(ctx, pingOf(sentPing(at(130))), tabOf())).toEqual({ ok: true });
    expect((await stored()).map((entry) => [entry.source, entry.lastSyncAt])).toEqual([
      ['gmail.sent', at(130)],
    ]);
  });
});

/** The head of the Sent list read at `readAt`, from 9:00 that morning. */
function sentPing(readAt: IsoTs) {
  return {
    observerId: 'gmail.sent',
    source: 'gmail.sent' as const,
    accountHash: sha(5),
    lastSyncAt: readAt,
    windowStart: '2026-10-03T09:00:00-04:00',
    windowEnd: readAt,
    userActive: false,
  };
}

function tabOf() {
  return { id: 'attest', frameId: 0, url: 'https://mail.google.com/', tab: { id: 3 } } as Parameters<
    typeof onCoveragePing
  >[2];
}
