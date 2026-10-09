/**
 * Schema v4 (Sprint 2 close; db.ts STORES_V4): every stored coverage interval gets its derived `kind` (a point or a
 * span) and `lenMs`, and the two indexes the bounded reads use (TECH-1); and observations lose the v1
 * counterparty-token index and its derived field (TECH-13). A ledger written at v3 opens at v4 with every interval and
 * every observation intact: each interval readable through the new indexes, so coverage and merging see it as before,
 * and each observation read back exactly as stored, through the strict read that would refuse a leftover field.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { coverageFor, placeEntry, recordCoverage } from '../../../src/ledger/coverage';
import { COVERAGE_INTERVALS, STORES_V4, type LedgerDb } from '../../../src/ledger/db';
import { INDEX_FIELDS, timeBucketOf, toObservationRow } from '../../../src/ledger/index-fields';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { getObservation, observationsByTypeAndBuckets } from '../../../src/ledger/repo';
import { Observation, ObserverCoverage, type ObserverCoverageInput } from '../../../src/ledger/types';
import { makeObservation, openAtVersion, pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

const opened: LedgerDb[] = [];

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

const WEEK: ObserverCoverageInput = {
  observerId: 'gcal.event',
  source: 'gcal.event',
  accountHash: sha(900),
  allCalendars: true,
  lastSyncAt: '2026-10-03T16:00:00Z',
  windowStart: '2026-10-04T04:00:00Z',
  windowEnd: '2026-10-11T04:00:00Z',
};
const MARKER: ObserverCoverageInput = {
  ...WEEK,
  lastSyncAt: '2026-10-03T15:00:00Z',
  changesSince: '2026-10-03T15:00:00Z',
  windowStart: '2026-10-06T14:00:00Z',
  windowEnd: '2026-10-06T14:00:00Z',
};

/** The row as the v2 and v3 code stored it: the entry and its v2 derived fields, no kind, no length. */
function v3Row(input: ObserverCoverageInput) {
  const { startMs, endMs, syncMs } = placeEntry(ObserverCoverage.parse(input));
  return { ...input, accountKey: input.accountHash ?? '', startMs, endMs, syncMs };
}

describe('v3 → v4', () => {
  it('declares v4 after v3: the kind and length of every interval, indexed', async () => {
    expect(MIGRATIONS.map((migration) => migration.version).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(MIGRATIONS[3]?.stores).toBe(STORES_V4);
    expect(INDEX_FIELDS.coverageIntervals).toEqual([
      'accountKey',
      'startMs',
      'endMs',
      'syncMs',
      'kind',
      'lenMs',
    ]);
    const db = await openLedger(uniqueDbName('v4'));
    opened.push(db);
    const names = db.table(COVERAGE_INTERVALS).schema.indexes.map((index) => index.name);
    expect(names).toEqual(
      expect.arrayContaining(['[source+kind+endMs]', '[source+kind+lenMs]', '[source+endMs]']),
    );
  });
});

describe('v3 → v4: the intervals', () => {
  it('upgrades a v3 ledger in place: each interval gets its kind and length, and reads and merges as before', async () => {
    const name = uniqueDbName('v3-to-v4');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 3));
    await old.table(COVERAGE_INTERVALS).bulkAdd([v3Row(WEEK), v3Row(MARKER)]);
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    // Upgraded through v4 to the shipped version (v5 adds the replay records, which no interval reads).
    expect(db.verno).toBe(MIGRATIONS.at(-1)?.version);
    const rows = await db.coverageIntervals.toArray();
    expect(rows.map((row) => [row.kind, row.lenMs])).toEqual([
      ['span', 7 * 86_400_000],
      ['point', 0],
    ]);
    const coverage = await coverageFor(
      db,
      {
        type: 'calendar.created',
        window: { fromMs: Date.parse('2026-10-06T13:58:00Z'), toMs: Date.parse('2026-10-06T14:47:00Z') },
        evaluatedAt: '2026-10-03T17:00:00Z',
      },
      DEFAULT_POLICY,
    );
    expect(coverage.observers).toEqual([WEEK, MARKER].map((input) => ObserverCoverage.parse(input)));
    // A later pass of the same week merges into the upgraded row (found through the v4 indexes), as it did before.
    await recordCoverage(db, { ...WEEK, lastSyncAt: '2026-10-03T16:30:00Z' });
    expect(await db.coverageIntervals.count()).toBe(2);
  });

  it('leaves a row without its v2 fields alone: no kind, in no index, skipped by every read as before', async () => {
    const name = uniqueDbName('v3-to-v4-odd');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 3));
    await old.table(COVERAGE_INTERVALS).add({ ...WEEK });
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    const [row] = await db.coverageIntervals.toArray();
    expect(row).not.toHaveProperty('kind');
    expect(
      await db.coverageIntervals
        .where('[source+kind+endMs]')
        .between(['gcal.event', ''], ['gcal.event', '~'])
        .count(),
    ).toBe(0);
  });
});

describe('v3 → v4: the observations', () => {
  it('drops the counterparty-token index and its field: every stored observation reads back exactly as stored', async () => {
    const name = uniqueDbName('v3-to-v4-observations');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 3));
    const row = makeObservation();
    // The row as the v1 to v3 code stored it: its time bucket and its counterparty tokens.
    const stored = { ...toObservationRow(Observation.parse(row)), counterpartyTokens: ['alice@example.com'] };
    await old.table('observations').add(stored);
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    expect(db.table('observations').schema.indexes.map((index) => index.name)).not.toContain(
      'counterpartyTokens',
    );
    expect(await db.observations.get(row.id)).not.toHaveProperty('counterpartyTokens');
    expect(await getObservation(db, row.id)).toEqual(row);
    const bucket = timeBucketOf(row.occurredAt);
    expect(await observationsByTypeAndBuckets(db, row.type, bucket, bucket)).toEqual([row]);
  });
});
