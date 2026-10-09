import 'fake-indexeddb/auto';
/**
 * src/ledger/activity.ts (sprint_3 3.14; docs/grading.md §7): session pings from pasted logs and the idle intervals
 * Chrome reports when the person turned away detection on. Each session once; an interval opened when the person goes
 * away and extended when they are back, even by a service worker started meanwhile; read over a range; purged after
 * retention; all deleted when away detection is turned off; exported; schema v6 adds the store to an older ledger.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IsoTs } from '../../../src/core/schema';
import {
  activityIn,
  closeIdle,
  forgetIdle,
  OPEN_IDLE,
  openIdle,
  purgeActivity,
  putSessions,
} from '../../../src/ledger/activity';
import { CLOCK_HIGH_WATER } from '../../../src/ledger/clock-guard';
import type { LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { getMeta, getReceipt, putReceipt } from '../../../src/ledger/repo';
import { Receipt } from '../../../src/ledger/types';
import { makeReceipt, openAtVersion, pinClock, releaseClock, uniqueDbName } from './fixtures';

const opened: LedgerDb[] = [];
const at = (iso: string) => IsoTs.parse(iso);
const ms = (iso: string) => Date.parse(iso);

beforeEach(() => {
  pinClock('2026-10-06T08:00:00-04:00');
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

async function open(): Promise<LedgerDb> {
  const db = await openLedger(uniqueDbName('activity'));
  opened.push(db);
  return db;
}

const DAY = [ms('2026-10-06T00:00:00-04:00'), ms('2026-10-07T00:00:00-04:00')] as const;

describe('session pings', () => {
  it('stores each agent’s minute once, and raises the clock high water', async () => {
    const db = await open();
    const minutes = [at('2026-10-06T14:02:00-04:00'), at('2026-10-06T14:05:00-04:00')];
    expect(await putSessions(db, 'muse', minutes)).toBe(2);
    expect(await putSessions(db, 'muse', [at('2026-10-06T18:02:00Z')])).toBe(0);
    expect(await putSessions(db, 'claude', [minutes[0] ?? at('2026-10-06T14:02:00-04:00')])).toBe(1);
    const { sessions, idle } = await activityIn(db, ...DAY);
    expect(sessions.map((s) => [s.agent, Date.parse(s.at)]).sort()).toEqual(
      [
        ['claude', ms('2026-10-06T14:02:00-04:00')],
        ['muse', ms('2026-10-06T14:02:00-04:00')],
        ['muse', ms('2026-10-06T14:05:00-04:00')],
      ].sort(),
    );
    expect(idle).toEqual([]);
    expect(await getMeta(db, CLOCK_HIGH_WATER)).toBe('2026-10-06T14:05:00-04:00');
  });
});

describe('idle intervals', () => {
  it('opens one when the person goes away, extends it when they are back, and opens no second while one is open', async () => {
    const db = await open();
    await openIdle(db, at('2026-10-06T14:00:00-04:00'), at('2026-10-06T14:01:00-04:00'));
    await openIdle(db, at('2026-10-06T14:03:00-04:00'), at('2026-10-06T14:04:00-04:00'));
    expect(typeof (await getMeta(db, OPEN_IDLE))).toBe('string');
    await closeIdle(db, at('2026-10-06T14:09:00-04:00'));
    expect(await getMeta(db, OPEN_IDLE)).toBeUndefined();
    await closeIdle(db, at('2026-10-06T14:30:00-04:00'));
    expect((await activityIn(db, ...DAY)).idle).toEqual([
      { from: '2026-10-06T14:00:00-04:00', to: '2026-10-06T14:09:00-04:00' },
    ]);
  });

  it('a worker started while the person was away still closes the open interval (it is named in the ledger)', async () => {
    const name = uniqueDbName('activity-restart');
    const before = await openLedger(name);
    await openIdle(before, at('2026-10-06T14:00:00-04:00'), at('2026-10-06T14:01:00-04:00'));
    before.close();
    const after = await openLedger(name);
    opened.push(after);
    await closeIdle(after, at('2026-10-06T14:09:00-04:00'));
    expect((await activityIn(after, ...DAY)).idle).toEqual([
      { from: '2026-10-06T14:00:00-04:00', to: '2026-10-06T14:09:00-04:00' },
    ]);
  });

  it('are all deleted, with the open one, when away detection is turned off', async () => {
    const db = await open();
    await putSessions(db, 'muse', [at('2026-10-06T14:02:00-04:00')]);
    await openIdle(db, at('2026-10-06T14:00:00-04:00'), at('2026-10-06T14:01:00-04:00'));
    expect(await forgetIdle(db)).toBe(1);
    expect(await getMeta(db, OPEN_IDLE)).toBeUndefined();
    const { sessions, idle } = await activityIn(db, ...DAY);
    expect([sessions.length, idle.length]).toEqual([1, 0]);
  });
});

describe('reads, purge, export and schema v6', () => {
  it('reads what reaches into a range, purges what ended before the cutoff, and exports every row', async () => {
    const db = await open();
    await putSessions(db, 'muse', [at('2026-10-05T23:59:00-04:00'), at('2026-10-06T14:02:00-04:00')]);
    await openIdle(db, at('2026-10-05T23:58:00-04:00'), at('2026-10-06T00:10:00-04:00'));
    const { sessions, idle } = await activityIn(db, ...DAY);
    expect([sessions.length, idle.length]).toEqual([1, 1]);
    const exported = await exportLedger(db, { exportedAt: '2026-10-06T16:00:00-04:00' });
    expect(exported.tables.activity.map((row) => row.kind).sort()).toEqual(['idle', 'session', 'session']);
    expect(await purgeActivity(db, ms('2026-10-06T00:05:00-04:00'))).toBe(1);
    expect(await db.activity.count()).toBe(2);
  });

  it('v6 adds the store, empty, to a v5 ledger, whose rows read as before', async () => {
    const name = uniqueDbName('v5-to-v6');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 5));
    expect(old.verno).toBe(5);
    await putReceipt(old, makeReceipt());
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    // v6, then v7's batch coverages (Sprint 3 close, TECH-1) and v8's receipt page indexes (sprint_4 4.0).
    expect(db.verno).toBe(8);
    expect(await getReceipt(db, Receipt.parse(makeReceipt()).id)).toEqual(Receipt.parse(makeReceipt()));
    expect(await db.activity.count()).toBe(0);
  });
});
