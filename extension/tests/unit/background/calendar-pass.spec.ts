/**
 * A Calendar pass completed by its snapshot (src/background/calendar-pass.ts; sprint_2 2.7 interfaces 2 and 5;
 * docs/grading.md §3, §4.1, §7; Hard Rules 5, 6, 7) over a real ledger: the pass's held pings and its snapshot
 * become rows (each with its first-look marker: since v1.12 a change too, Decisions [2.close]), a stored record and
 * coverage, with `changesSince` only where every change was reported.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { onCalendarSnapshot } from '../../../src/background/calendar-pass';
import { windowInRange } from '../../../src/background/calendar-window';
import { onCoveragePing, onHealth } from '../../../src/background/observer-messages';
import { getCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth } from '../../../src/ledger/repo';
import { CoveragePing } from '../../../src/ledger/types';
import { pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, event, keyOf, RANGE, week } from './calendar-fixtures';
import {
  entryOf,
  eventOn,
  markerOf,
  markers,
  postedElsewhere,
  runPass,
  weekPing,
  windows,
} from './calendar-pass-harness';
import { contextOf, healthOf, pingOf, snapshotOf, tab, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-pass'));
  ctx = contextOf(db);
});

afterEach(() => {
  db.close();
  releaseClock();
});

const pass = (snapshot: Parameters<typeof runPass>[1], options: Parameters<typeof runPass>[2] = {}) =>
  runPass(ctx, snapshot, options);
const typesStored = async () => (await db.observations.toArray()).map((row) => row.type).sort();
const record = () => getCalendarRecord(db, { observerId: 'gcal.event', accountHash: ACCOUNT, range: RANGE });

describe('a pass with a known account', () => {
  it('a first look stores each event as a first sighting with its marker, the record, then its window', async () => {
    const b = eventOn('b', '2026-10-07');
    expect(await pass(week([event('a'), b], { readAt: at(0) }))).toEqual({ ok: true });
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.created']);
    expect(await markers(db)).toEqual([markerOf(event('a'), at(0)), markerOf(b, at(0))]);
    expect((await record())?.snapshot.readAt).toBe(at(0));
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(0))), changesSince: at(0) }]);
    expect(ctx.notified).toContainEqual([
      'calendarSnapshots',
      'observations',
      'coverageIntervals',
      'coverage',
    ]);
  });

  it('a later pass reports the change with its marker (v1.12), and extends the window followed since the first look', async () => {
    await pass(week([event('a')], { readAt: at(0) }));
    const b = eventOn('b', '2026-10-07');
    expect(await pass(week([event('a'), b], { readAt: at(1) }))).toEqual({ ok: true });
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.created']);
    // Who made it is not known (Decisions [2.close]): stored as a first sighting, so it never accuses an agent.
    expect(await markers(db)).toEqual([markerOf(event('a'), at(0)), markerOf(b, at(1))]);
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(1))), changesSince: at(0) }]);
  });

  it('a change compared with a base read more than two minutes before it is a first sighting, with its marker', async () => {
    await pass(week([event('a')], { readAt: at(0) }));
    const b = eventOn('b', '2026-10-07');
    expect(await pass(week([event('a'), b], { readAt: at(10) }))).toEqual({ ok: true });
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.created']);
    // b may have been made at any time in (at(0), at(10)]: anchored at at(10), it could name whoever was active then.
    expect(await markers(db)).toEqual([markerOf(event('a'), at(0)), markerOf(b, at(10))]);
    // The windows still follow changes since the first look: only the row is kept from accusing.
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(10))), changesSince: at(0) }]);
  });

  it('an edit is stored as one calendar.updated, never as a calendar.created of the new state', async () => {
    await pass(week([event('a')], { readAt: at(0) }));
    await pass(
      week([event('a', { occurredAt: '2026-10-06T15:00:00-04:00', endAt: '2026-10-06T16:00:00-04:00' })], {
        readAt: at(1),
      }),
    );
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.updated']);
    // The first look's marker and the update's own (v1.12: every change is stored as a first sighting).
    expect(await markers(db)).toHaveLength(2);
  });
});

describe('what the stored record keeps of the guests (SEC-2, Hard Rule 2)', () => {
  it('each event’s first guest in clear and a key per guest; the other addresses never reach the store', async () => {
    const guests = ['amy@example.org', 'Sam.Chen@example.net', 'zed@example.com'];
    const review = eventOn('r', '2026-10-07', 15, { guests, guestCount: 3 });
    expect(await pass(week([review], { readAt: at(0) }))).toEqual({ ok: true });
    const moved = { ...review, guests: guests.slice(1), guestCount: 2 };
    expect(await pass(week([moved], { readAt: at(1) }))).toEqual({ ok: true });
    const stored = JSON.stringify(await db.calendarSnapshots.toArray()).toLowerCase();
    expect(stored).toContain('sam.chen@example.net');
    expect(stored).not.toContain('amy@example.org');
    expect(stored).not.toContain('zed@example.com');
    expect((await record())?.snapshot.events[0]).toMatchObject({
      firstGuest: 'Sam.Chen@example.net',
      guestCount: 2,
    });
    // The update that removed amy is still seen: the guests are compared by key.
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.updated']);
  });
});

describe('a pass that cannot report every change', () => {
  it('a pass waiting to confirm an absence records no window; the confirming pass stores the deletion first', async () => {
    await pass(week([event('a'), eventOn('b', '2026-10-07')], { readAt: at(0) }));
    expect(await pass(week([event('a')], { readAt: at(1) }))).toEqual({ ok: true });
    expect((await windows(db)).map((entry) => entry.lastSyncAt)).toEqual([at(0)]);
    expect((await record())?.pending).toEqual([{ key: keyOf('b'), since: at(1), baseAt: at(0) }]);
    // Confirmed much later: the deletion is judged by its first absence, compared with a base a minute older.
    await pass(week([event('a')], { readAt: at(20) }));
    const deleted = (await db.observations.toArray()).find((row) => row.type === 'calendar.deleted');
    expect(deleted?.observedAt).toBe(at(1));
    expect(await windows(db)).toEqual([{ ...entryOf(weekPing(at(20))), changesSince: at(0) }]);
    // The first look's two markers and the deletion's own, at its first absence (v1.12).
    expect((await markers(db)).map((entry) => entry.lastSyncAt)).toEqual([at(0), at(0), at(1)]);
  });

  it('a pass that cannot vouch for changes records its windows without changesSince; its sightings have markers', async () => {
    const busy = eventOn('h', '2026-10-08', 10);
    const hidden = week([event('a'), busy], { readAt: at(0), hidden: ['2026-10-08'] });
    const pings = [
      weekPing(at(0), { windowEnd: '2026-10-08T00:00:00-04:00' }),
      weekPing(at(0), { windowStart: '2026-10-09T00:00:00-04:00' }),
    ];
    expect(await pass(hidden, { pings })).toEqual({ ok: true });
    expect((await windows(db)).map((entry) => entry.changesSince)).toEqual([undefined, undefined]);
    // The event on the hidden day lies in no window; its marker covers its own instant.
    expect(await markers(db)).toEqual([markerOf(event('a'), at(0)), markerOf(busy, at(0))]);
  });

  it('a marker says every calendar was shown only when each listed one was shown and named once', async () => {
    await pass(week([event('a')], { readAt: at(0), familyShown: true }));
    // Another account's first look, whose list names the main calendar twice.
    const twice = week([eventOn('c', '2026-10-09')], {
      readAt: at(10),
      familyShown: true,
      mainNamedTwice: true,
    });
    expect(await pass(twice, { account: sha(78) })).toEqual({ ok: true });
    expect((await markers(db)).map((entry) => [entry.accountHash, entry.allCalendars])).toEqual([
      [ACCOUNT, true],
      [sha(78), false],
    ]);
  });
});

describe('a snapshot that changes nothing', () => {
  it('one older than the stored one is skipped, not DEGRADED (another tab landed first)', async () => {
    await pass(week([event('a')], { readAt: at(10) }));
    expect(await pass(week([event('a'), event('b')], { readAt: at(0) }))).toEqual({
      ok: false,
      code: 'late_sighting',
    });
    expect(await typesStored()).toEqual(['calendar.created']);
    expect(await getAdapterHealth(db, 'gcal.event')).toBeUndefined();
    expect((await record())?.snapshot.readAt).toBe(at(10));
  });

  it('the stored snapshot delivered again is skipped: one absence never confirms itself as a deletion', async () => {
    await pass(week([event('a'), event('b')], { readAt: at(0) }));
    const absent = week([event('a')], { readAt: at(10) });
    await pass(absent);
    const waiting = [{ key: keyOf('b'), since: at(10), baseAt: at(0) }];
    expect((await record())?.pending).toEqual(waiting);
    expect(await onCalendarSnapshot(ctx, snapshotOf(absent, ACCOUNT), tab())).toEqual({
      ok: false,
      code: 'late_sighting',
    });
    expect(await typesStored()).toEqual(['calendar.created', 'calendar.created']);
    expect((await record())?.pending).toEqual(waiting);
  });

  it('one without an account is skipped: such a page is compared with nothing', async () => {
    expect(await onCalendarSnapshot(ctx, snapshotOf(week([event('a')])), tab())).toEqual({ ok: true });
    expect(await db.observations.count()).toBe(0);
    expect(await db.calendarSnapshots.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
  });
});

describe('a snapshot that cannot be what it says is refused and the observer DEGRADED', () => {
  it('another account than its own pass pinged', async () => {
    expect(await onCoveragePing(ctx, pingOf(weekPing(at(0))), tab())).toEqual({ ok: true });
    expect(await onCalendarSnapshot(ctx, snapshotOf(week([event('a')]), sha(77)), tab())).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(await db.observations.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ status: 'DEGRADED' });
  });

  it('a window outside its range', () => {
    const snapshot = week([event('a')]);
    expect(windowInRange(CoveragePing.parse(weekPing(at(0))), snapshot)).toBe(true);
    const outside = weekPing(at(0), {
      windowStart: '2026-10-11T00:00:00-04:00',
      windowEnd: '2026-10-12T00:00:00-04:00',
    });
    expect(windowInRange(CoveragePing.parse(outside), snapshot)).toBe(false);
  });

  it('a window over a day the snapshot hid behind "N more": that day was not seen (Hard Rule 5)', async () => {
    const hidden = week([event('a')], { readAt: at(0), hidden: ['2026-10-08'] });
    const runs = [
      weekPing(at(0), { windowEnd: '2026-10-08T00:00:00-04:00' }),
      weekPing(at(0), { windowStart: '2026-10-09T00:00:00-04:00' }),
    ];
    for (const run of runs) expect(windowInRange(CoveragePing.parse(run), hidden)).toBe(true);
    const across = weekPing(at(0));
    expect(windowInRange(CoveragePing.parse(across), hidden)).toBe(false);
    const within = weekPing(at(0), {
      windowStart: '2026-10-08T00:00:00-04:00',
      windowEnd: '2026-10-08T12:00:00-04:00',
    });
    expect(windowInRange(CoveragePing.parse(within), hidden)).toBe(false);
    expect(await pass(hidden, { pings: [across] })).toEqual({ ok: false, code: 'invalid_input' });
    expect(await db.observations.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ reasons: ['ledger.invalid_input'] });
  });

  it('a snapshot from an observer that is not the Calendar observer', async () => {
    const answer = await onCalendarSnapshot(
      ctx,
      snapshotOf(week([event('a')]), ACCOUNT, 'gmail.sent'),
      tab(),
    );
    expect(answer).toEqual({ ok: false, code: 'invalid_input' });
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ reasons: ['ledger.invalid_input'] });
  });
});

describe('a pass with a refused ping', () => {
  it('the snapshot of a pass one of whose pings was refused: nothing of that pass is stored', async () => {
    expect(await onCoveragePing(ctx, pingOf(weekPing(at(0))), tab())).toEqual({ ok: true });
    const other = weekPing(at(0), { accountHash: sha(77), windowStart: '2026-10-05T00:00:00-04:00' });
    expect(await onCoveragePing(ctx, pingOf(other), tab())).toEqual({ ok: false, code: 'invalid_input' });
    expect(await onCalendarSnapshot(ctx, snapshotOf(week([event('a')]), ACCOUNT), tab())).toEqual({
      ok: false,
      code: 'refused',
    });
    expect(await db.observations.count()).toBe(0);
    expect(await db.calendarSnapshots.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
  });
});

describe('rows the ledger refuses', () => {
  it('store nothing of the pass, and turn the observer DEGRADED; the next pass derives them again', async () => {
    // Another tab's later sighting of the same first-sighting row is already stored (with its own marker).
    await postedElsewhere(ctx, event('a'), at(5));
    const before = await db.coverageIntervals.count();
    expect(await pass(week([event('a')], { readAt: at(0) }))).toEqual({ ok: false, code: 'late_sighting' });
    expect(await db.calendarSnapshots.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(before);
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ reasons: ['ledger.late_sighting'] });
    // A later clean pass stores its record and coverage, and clears the DEGRADED with its own report.
    await onHealth(ctx, healthOf('gcal.event', at(10)));
    expect(await pass(week([event('a')], { readAt: at(10) }))).toEqual({ ok: true });
    expect(await db.calendarSnapshots.count()).toBe(1);
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ status: 'OK', checkedAt: at(10) });
  });
});
