/**
 * Schema v2 (Sprint 2.6; db.ts STORES_V2): a ledger written at v1 opens at v2 with every row intact, the new receipt
 * indexes built over the rows it already held (`*observationIds`, `supersededBy`: the retention purge reads through
 * them), and the coverage interval store present and empty.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { COVERAGE_INTERVALS, STORES_V2, type LedgerDb } from '../../../src/ledger/db';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import {
  getClaim,
  getCoveragePing,
  getObservation,
  getReceipt,
  putCoveragePing,
  putReceipt,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import {
  claimId,
  makeClaim,
  makeObservation,
  makePing,
  makeReceipt,
  observationId,
  openAtVersion,
  pinClock,
  releaseClock,
  ulid,
  uniqueDbName,
} from './fixtures';

const opened: LedgerDb[] = [];

async function open(name: string, migrations = MIGRATIONS): Promise<LedgerDb> {
  const db = await openLedger(name, migrations);
  opened.push(db);
  return db;
}

const indexOf = (db: LedgerDb, table: string, name: string) =>
  db.table(table).schema.indexes.find((index) => index.name === name);

/** An UNASKED receipt of observation 1, superseded by claim 101. */
const SUPERSEDED = makeReceipt({
  id: ulid(305),
  claimId: undefined,
  requestId: undefined,
  grade: 'UNASKED',
  attribution: 'likely',
  ruleId: 'unasked',
  reasons: [{ code: 'superseded', params: { claimId: claimId(101) } }],
  supersededBy: claimId(101),
});

async function seedV1(name: string): Promise<void> {
  const db = await openAtVersion(name, MIGRATIONS.slice(0, 1));
  expect(db.verno).toBe(1);
  await upsertObservation(db, makeObservation(), DEFAULT_POLICY);
  await upsertClaim(db, makeClaim());
  await putReceipt(db, makeReceipt());
  await putReceipt(db, SUPERSEDED);
  await putCoveragePing(db, makePing());
  db.close();
}

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

describe('v1 → v2', () => {
  it('declares v2: the receipt indexes and the coverage interval store', async () => {
    expect(MIGRATIONS.map((migration) => migration.version).slice(0, 2)).toEqual([1, 2]);
    expect(MIGRATIONS[1]?.stores).toBe(STORES_V2);
    const db = await open(uniqueDbName('v2'));
    expect(indexOf(db, 'receipts', 'observationIds')?.multi).toBe(true);
    expect(indexOf(db, 'receipts', 'supersededBy')).toBeDefined();
    const store = db.table(COVERAGE_INTERVALS).schema;
    // An outbound auto-increment key: no key field in the row, nothing to strip on read.
    expect(store.primKey).toMatchObject({ keyPath: null, auto: true });
    for (const name of ['[source+endMs]', '[source+accountKey]', '[source+accountKey+syncMs]']) {
      expect(indexOf(db, COVERAGE_INTERVALS, name)?.compound, name).toBe(true);
    }
  });

  it('upgrades a v1 ledger in place: rows intact, new indexes built over them, an empty interval store', async () => {
    const name = uniqueDbName('v1-to-v2');
    await seedV1(name);
    const db = await openAtVersion(name, MIGRATIONS.slice(0, 2));
    opened.push(db);
    expect(db.verno).toBe(2);
    expect(await getObservation(db, makeObservation().id)).toEqual(makeObservation());
    expect(await getClaim(db, makeClaim().id)).toEqual(makeClaim());
    expect(await getReceipt(db, makeReceipt().id)).toEqual(makeReceipt());
    expect(await getCoveragePing(db, 'gmail', makePing().accountHash)).toEqual(makePing());
    const naming = await db.receipts.where('observationIds').equals(observationId(1)).primaryKeys();
    expect(naming.sort()).toEqual([ulid(301), ulid(305)].sort());
    expect(await db.receipts.where('supersededBy').equals(claimId(101)).primaryKeys()).toEqual([ulid(305)]);
    expect(await db.coverageIntervals.count()).toBe(0);
  });
});
