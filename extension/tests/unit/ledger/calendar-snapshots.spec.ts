/**
 * The Calendar snapshot store (src/ledger/calendar-snapshots.ts; schema v3; sprint_2 2.7; Hard Rules 2, 5): records
 * keyed by observer, account hash and range, parsed on write and on read, replaced only by a later read, exported
 * with the rest of the ledger, and purged with retention. A record keeps each event's first guest in clear and only a
 * key per guest (SEC-2): never every guest address of every event.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordCoverage } from '../../../src/ledger/coverage';
import {
  getCalendarRecord,
  purgeCalendarRecords,
  putCalendarRecord,
} from '../../../src/ledger/calendar-snapshots';
import type { LedgerDb } from '../../../src/ledger/db';
import { exportLedger, LedgerExport } from '../../../src/ledger/export';
import { openLedger } from '../../../src/ledger/migrations';
import { purgeExpired } from '../../../src/ledger/retention';
import { guestKey, StoredEvent } from '../../../src/observers/gcal/snapshot';
import { ACCOUNT, at, event, keyOf, RANGE, record, week } from '../background/calendar-fixtures';
import { captureLogs, expectLedgerError, pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-snapshots'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const KEY = { observerId: 'gcal.event', accountHash: ACCOUNT, range: RANGE };

describe('putCalendarRecord / getCalendarRecord', () => {
  it('stores a record and reads it back exactly, keyed by observer, account and range', async () => {
    const stored = record(week([event('a')], { readAt: at(0) }));
    expect(await putCalendarRecord(db, stored)).toEqual({ written: true });
    expect(await getCalendarRecord(db, KEY)).toEqual(stored);
    expect(await getCalendarRecord(db, { ...KEY, accountHash: sha(5) })).toBeUndefined();
    const row = await db.calendarSnapshots.get([KEY.observerId, KEY.accountHash, KEY.range]);
    expect(row?.readMs).toBe(Date.parse(at(0)));
  });

  it('is replaced only by a record read later', async () => {
    await putCalendarRecord(db, record(week([event('a')], { readAt: at(10) })));
    expect(await putCalendarRecord(db, record(week([event('b')], { readAt: at(0) })))).toEqual({
      written: false,
    });
    expect(await putCalendarRecord(db, record(week([event('c')], { readAt: at(10) })))).toEqual({
      written: false,
    });
    expect((await getCalendarRecord(db, KEY))?.snapshot.events.map((each) => each.key)).toEqual([keyOf('a')]);
    expect(await putCalendarRecord(db, record(week([event('d')], { readAt: at(20) })))).toEqual({
      written: true,
    });
    expect((await getCalendarRecord(db, KEY))?.snapshot.events.map((each) => each.key)).toEqual([keyOf('d')]);
  });

  it('refuses a record that is not one (invalid_input, field names only) and writes nothing', async () => {
    const snapshot = week([event('a')]);
    await expectLedgerError(
      putCalendarRecord(db, { ...record(snapshot), range: '2026-11-01/2026-11-07' }),
      'invalid_input',
    );
    await expectLedgerError(
      putCalendarRecord(db, { ...record(snapshot), pending: [{ key: keyOf('zz'), since: at(0) }] }),
      'invalid_input',
    );
    await expectLedgerError(
      putCalendarRecord(db, { ...record(snapshot), accountHash: 'avery@example.com' }),
      'invalid_input',
    );
    expect(await db.calendarSnapshots.count()).toBe(0);
  });

  it('a stored row that fails its schema reads as none and is logged without its content', async () => {
    const { records: logs, restore } = captureLogs();
    await db.calendarSnapshots.put({
      ...record(week([event('a')])),
      snapshot: { secret: 'Dinner with Ottoline' },
      readMs: 0,
    } as never);
    expect(await getCalendarRecord(db, KEY)).toBeUndefined();
    restore();
    expect(logs.map((each) => each.event)).toEqual(['ledger.row_invalid']);
    expect(JSON.stringify(logs)).not.toContain('Ottoline');
  });
});

describe('export and retention', () => {
  it('the export holds the Calendar records and the coverage intervals as strict domain objects', async () => {
    const stored = record(week([event('a')], { readAt: at(0) }));
    await putCalendarRecord(db, stored);
    const interval = {
      observerId: 'gcal.event',
      source: 'gcal.event' as const,
      lastSyncAt: at(0),
      windowStart: '2026-10-04T00:00:00-04:00',
      windowEnd: '2026-10-11T00:00:00-04:00',
      accountHash: ACCOUNT,
      allCalendars: false,
      changesSince: at(0),
    };
    await recordCoverage(db, interval);
    const exported = await exportLedger(db, { exportedAt: at(30) });
    expect(exported.tables.calendarSnapshots).toEqual([stored]);
    expect(exported.tables.coverageIntervals).toEqual([interval]);
    expect(LedgerExport.parse(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
  });

  it('an export from before Sprint 2.7 (without these tables) still parses, with both empty', async () => {
    const exported = JSON.parse(JSON.stringify(await exportLedger(db, { exportedAt: at(30) }))) as {
      tables: Record<string, unknown>;
    };
    delete exported.tables.calendarSnapshots;
    delete exported.tables.coverageIntervals;
    const parsed = LedgerExport.parse(exported);
    expect(parsed.tables.calendarSnapshots).toEqual([]);
    expect(parsed.tables.coverageIntervals).toEqual([]);
  });

  it('the purge deletes exactly the records read before its cutoff', async () => {
    await putCalendarRecord(db, record(week([event('a')], { readAt: at(0) })));
    await putCalendarRecord(db, { ...record(week([event('b')], { readAt: at(10) })), accountHash: sha(5) });
    expect(await purgeCalendarRecords(db, Date.parse(at(10)))).toBe(1);
    expect(await getCalendarRecord(db, KEY)).toBeUndefined();
    expect(await getCalendarRecord(db, { ...KEY, accountHash: sha(5) })).toBeDefined();
  });

  it('the retention purge reports the Calendar records it removed', async () => {
    await putCalendarRecord(db, record(week([event('a')], { readAt: at(0) })));
    const report = await purgeExpired(db, { now: '2027-03-01T00:00:00Z' });
    expect(report.calendarSnapshots).toBe(1);
    expect(await db.calendarSnapshots.count()).toBe(0);
  });
});

describe('what a record keeps of an event’s guests (SEC-2, Hard Rule 2)', () => {
  const GUESTS = ['amy@example.org', 'Sam.Chen@example.net', 'zed@example.com'];
  const HIDDEN = ['sam.chen@example.net', 'zed@example.com'];
  const withGuests = (readAt = at(0)) => week([event('b', { guests: GUESTS, guestCount: 4 })], { readAt });

  it('its first guest in clear and a key per guest, in the store and in the export', async () => {
    await putCalendarRecord(db, record(withGuests()));
    const [stored] = (await getCalendarRecord(db, KEY))?.snapshot.events ?? [];
    expect(stored).toMatchObject({
      firstGuest: 'amy@example.org',
      guestKeys: GUESTS.map(guestKey).sort(),
      guestCount: 4,
    });
    expect(stored).not.toHaveProperty('guests');
    const raw = JSON.stringify(await db.calendarSnapshots.toArray()).toLowerCase();
    const exported = JSON.stringify(await exportLedger(db, { exportedAt: at(30) })).toLowerCase();
    for (const text of [raw, exported]) {
      expect(text).toContain('amy@example.org');
      for (const hidden of HIDDEN) expect(text, hidden).not.toContain(hidden);
    }
  });

  it('a record stored in the page form, before SEC-2, is read as its stored form and rewritten so', async () => {
    const page = withGuests();
    await db.calendarSnapshots.put({
      ...KEY,
      snapshot: page,
      pending: [],
      readMs: Date.parse(at(0)),
    } as never);
    const read = await getCalendarRecord(db, KEY);
    expect(read?.snapshot.format).toBe(2);
    expect(read?.snapshot.events[0]?.firstGuest).toBe('amy@example.org');
    for (const hidden of HIDDEN) expect(JSON.stringify(read).toLowerCase()).not.toContain(hidden);
    await putCalendarRecord(db, record(withGuests(at(1))));
    const raw = JSON.stringify(await db.calendarSnapshots.toArray()).toLowerCase();
    for (const hidden of HIDDEN) expect(raw).not.toContain(hidden);
  });

  it('refuses a stored event whose first guest is not one of its keys, or whose keys are not ascending', () => {
    const [stored] = record(withGuests()).snapshot.events;
    if (stored === undefined) throw new Error('no event');
    expect(StoredEvent.safeParse(stored).success).toBe(true);
    expect(StoredEvent.safeParse({ ...stored, firstGuest: 'other@example.com' }).success).toBe(false);
    expect(StoredEvent.safeParse({ ...stored, guestKeys: [...stored.guestKeys].reverse() }).success).toBe(
      false,
    );
    expect(StoredEvent.safeParse({ ...stored, guestCount: 2 }).success).toBe(false);
    const withoutFirst = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'firstGuest'));
    expect(StoredEvent.safeParse(withoutFirst).success).toBe(false);
    expect(StoredEvent.safeParse({ ...withoutFirst, guestKeys: [] }).success).toBe(true);
  });
});
