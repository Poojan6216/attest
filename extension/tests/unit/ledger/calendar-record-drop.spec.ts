/**
 * `dropCalendarRecord` and `purgeCalendarRecords` (src/ledger/calendar-snapshots.ts; sprint_2 2.7), two per repo
 * method as qa_tester rule 3 asks: the happy path, and the duplicate (a second call, a record that is not there).
 * Added by the Sprint 2 QA review: the service worker drops a range's record to restart its chain after a refused
 * pass (src/background/calendar-pass.ts `restartChain`), and no test called the method itself.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  dropCalendarRecord,
  getCalendarRecord,
  purgeCalendarRecords,
  putCalendarRecord,
} from '../../../src/ledger/calendar-snapshots';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { ACCOUNT, at, event, RANGE, record, week } from '../background/calendar-fixtures';
import { pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-record-drop'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const KEY = { observerId: 'gcal.event', accountHash: ACCOUNT, range: RANGE };
const OTHER_ACCOUNT = { ...KEY, accountHash: sha(5) };

describe('dropCalendarRecord', () => {
  it('happy: deletes exactly the record of its observer, account and range, and says it did', async () => {
    await putCalendarRecord(db, record(week([event('a')], { readAt: at(0) })));
    await putCalendarRecord(db, { ...record(week([event('b')], { readAt: at(1) })), accountHash: sha(5) });
    expect(await dropCalendarRecord(db, KEY)).toBe(true);
    expect(await getCalendarRecord(db, KEY)).toBeUndefined();
    expect((await getCalendarRecord(db, OTHER_ACCOUNT))?.snapshot.readAt).toBe(at(1));
    // The range starts again: an older snapshot may now be stored as its first record.
    expect(await putCalendarRecord(db, record(week([event('c')], { readAt: at(0) })))).toEqual({
      written: true,
    });
  });

  it('duplicate: dropping a record twice, or one never stored, changes nothing and says so', async () => {
    await putCalendarRecord(db, record(week([event('a')], { readAt: at(0) })));
    expect(await dropCalendarRecord(db, KEY)).toBe(true);
    expect(await dropCalendarRecord(db, KEY)).toBe(false);
    expect(await dropCalendarRecord(db, { ...KEY, range: '2026-10-11/2026-10-17' })).toBe(false);
    expect(await db.calendarSnapshots.count()).toBe(0);
  });
});

describe('purgeCalendarRecords', () => {
  it('duplicate: a second purge at the same cutoff removes nothing more', async () => {
    await putCalendarRecord(db, record(week([event('a')], { readAt: at(0) })));
    await putCalendarRecord(db, { ...record(week([event('b')], { readAt: at(10) })), accountHash: sha(5) });
    expect(await purgeCalendarRecords(db, Date.parse(at(10)))).toBe(1);
    expect(await purgeCalendarRecords(db, Date.parse(at(10)))).toBe(0);
    expect(await db.calendarSnapshots.count()).toBe(1);
  });
});
