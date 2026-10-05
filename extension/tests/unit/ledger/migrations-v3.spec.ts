/**
 * Schema v3 (Sprint 2.7; db.ts STORES_V3): a ledger written at v2 opens at the shipped version with every row intact
 * (its coverage intervals included) and the Calendar snapshot store present, empty, keyed by observer, account hash
 * and range. (v4, the Sprint 2 close, follows it: tests/unit/ledger/migrations-v4.spec.ts.)
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { coverageFor, placeEntry } from '../../../src/ledger/coverage';
import { CALENDAR_SNAPSHOTS, STORES_V3, type LedgerDb } from '../../../src/ledger/db';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { getObservation, upsertObservation } from '../../../src/ledger/repo';
import { ObserverCoverage } from '../../../src/ledger/types';
import { makeObservation, openAtVersion, pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

const opened: LedgerDb[] = [];

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

const INTERVAL = {
  observerId: 'gmail.sent',
  source: 'gmail.sent' as const,
  lastSyncAt: '2026-10-01T10:00:00Z',
  windowStart: '2026-10-01T09:00:00Z',
  windowEnd: '2026-10-01T10:00:00Z',
  accountHash: sha(900),
};

describe('v2 → v3', () => {
  it('declares v3 in the shipped list: the Calendar snapshot store and its purge index', async () => {
    expect(MIGRATIONS.map((migration) => migration.version).slice(0, 3)).toEqual([1, 2, 3]);
    expect(MIGRATIONS[2]?.stores).toBe(STORES_V3);
    const db = await openLedger(uniqueDbName('v3'));
    opened.push(db);
    const store = db.table(CALENDAR_SNAPSHOTS).schema;
    expect(store.primKey.keyPath).toEqual(['observerId', 'accountHash', 'range']);
    expect(store.indexes.map((index) => index.name)).toEqual(['readMs']);
  });

  it('upgrades a v2 ledger in place: rows and coverage intact, an empty snapshot store', async () => {
    const name = uniqueDbName('v2-to-v3');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 2));
    await upsertObservation(old, makeObservation(), DEFAULT_POLICY);
    // The interval as the v2 code stored it: the entry and its v2 derived fields (no v4 kind or length yet).
    const { startMs, endMs, syncMs } = placeEntry(ObserverCoverage.parse(INTERVAL));
    await old.table('coverageIntervals').add({ ...INTERVAL, accountKey: sha(900), startMs, endMs, syncMs });
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    expect(db.verno).toBe(MIGRATIONS.at(-1)?.version);
    expect(await getObservation(db, makeObservation().id)).toEqual(makeObservation());
    const coverage = await coverageFor(
      db,
      { type: 'email.sent', window: null, evaluatedAt: '2026-10-02T00:00:00Z' },
      DEFAULT_POLICY,
    );
    expect(coverage.observers).toEqual([INTERVAL]);
    expect(await db.calendarSnapshots.count()).toBe(0);
  });
});
