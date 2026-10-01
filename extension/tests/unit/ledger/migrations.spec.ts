import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { LEDGER_TABLE_NAMES } from '../../../src/ledger/index-fields';
import {
  MIGRATIONS,
  assertValidMigrations,
  openLedger,
  type Migration,
} from '../../../src/ledger/migrations';
import {
  getClaim,
  getMeta,
  getObservation,
  setMeta,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import { Observation } from '../../../src/ledger/types';
import { captureLogs, expectLedgerError, makeClaim, makeObservation, omit, uniqueDbName } from './fixtures';

const OBSERVATIONS_V1 = 'id, &contentHash, [type+timeBucket], *counterpartyTokens, occurredAt';

const opened: LedgerDb[] = [];

async function open(name: string, migrations: readonly Migration[] = MIGRATIONS): Promise<LedgerDb> {
  const db = await openLedger(name, migrations);
  opened.push(db);
  return db;
}

async function seedV1(name: string): Promise<void> {
  const db = await open(name);
  await upsertObservation(db, makeObservation());
  await upsertClaim(db, makeClaim());
  await setMeta(db, 'lastPurgeAt', '2026-09-30T00:00:00Z');
  db.close();
}

function indexOf(db: LedgerDb, table: string, name: string) {
  return db.table(table).schema.indexes.find((index) => index.name === name);
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe('schema v1', () => {
  it('opens at version 1 with exactly the eight ledger tables', async () => {
    const db = await open(uniqueDbName('v1'));
    expect(db.verno).toBe(1);
    expect(db.tables.map((table) => table.name).sort()).toEqual([...LEDGER_TABLE_NAMES].sort());
  });

  it('declares the tech_reviewer indexes (unique hashes, compound, multiEntry)', async () => {
    const db = await open(uniqueDbName('v1-idx'));
    expect(indexOf(db, 'observations', 'contentHash')?.unique).toBe(true);
    expect(indexOf(db, 'claims', 'rawHash')?.unique).toBe(true);
    expect(indexOf(db, 'observations', '[type+timeBucket]')?.compound).toBe(true);
    expect(indexOf(db, 'observations', 'counterpartyTokens')?.multi).toBe(true);
    for (const table of ['claims', 'requests', 'receipts']) {
      expect(indexOf(db, table, '[agent+date]')?.compound, table).toBe(true);
    }
    expect(db.coverage.schema.primKey.compound).toBe(true);
    expect(db.coverage.schema.primKey.keyPath).toEqual(['observerId', 'accountKey']);
    expect(db.grants.schema.primKey.keyPath).toBe('agent');
  });
});

describe('v1 → v2 migrations', () => {
  it('a no-op v2 preserves every row and bumps verno', async () => {
    const name = uniqueDbName('noop');
    await seedV1(name);
    const db = await open(name, [...MIGRATIONS, { version: 2, stores: {} }]);
    expect(db.verno).toBe(2);
    expect(await getObservation(db, makeObservation().id)).toEqual(makeObservation());
    expect(await getClaim(db, makeClaim().id)).toEqual(makeClaim());
    expect(await getMeta(db, 'lastPurgeAt')).toBe('2026-09-30T00:00:00Z');
  });

  it('a v2 that adds an index builds it over existing rows', async () => {
    const name = uniqueDbName('add-index');
    await seedV1(name);
    const db = await open(name, [
      ...MIGRATIONS,
      { version: 2, stores: { observations: `${OBSERVATIONS_V1}, source` } },
    ]);
    expect(indexOf(db, 'observations', 'source')).toBeDefined();
    const rows = await db.observations.where('source').equals('gmail.sent').toArray();
    expect(rows.map((row) => row.id)).toEqual([makeObservation().id]);
    // Pre-existing unique index still enforced after the upgrade.
    expect((await upsertObservation(db, makeObservation({ id: makeClaim().id }))).inserted).toBe(false);
  });

  it('runs an upgrade function exactly once', async () => {
    const name = uniqueDbName('upgrade-once');
    await seedV1(name);
    let runs = 0;
    const v2: Migration = {
      version: 2,
      stores: {},
      upgrade: async (tx) => {
        runs += 1;
        await tx.table('meta').put({ key: 'backfilledV2', value: true });
      },
    };
    const first = await open(name, [...MIGRATIONS, v2]);
    expect(await getMeta(first, 'backfilledV2')).toBe(true);
    first.close();
    await open(name, [...MIGRATIONS, v2]);
    expect(runs).toBe(1);
  });

  it('a failing upgrade rejects with open_failed, logs, and leaves v1 data intact', async () => {
    const name = uniqueDbName('upgrade-fails');
    await seedV1(name);
    const logs = captureLogs();
    try {
      const failing: Migration = {
        version: 2,
        stores: {},
        upgrade: () => Promise.reject(new Error('backfill exploded')),
      };
      await expectLedgerError(openLedger(name, [...MIGRATIONS, failing]), 'open_failed');
    } finally {
      logs.restore();
    }
    expect(logs.records.map((record) => record.event)).toContain('ledger.open_failed');
    const db = await open(name);
    expect(db.verno).toBe(1);
    expect(Observation.parse(await getObservation(db, makeObservation().id))).toEqual(makeObservation());
  });
});

describe('assertValidMigrations', () => {
  it('accepts the shipped list', () => {
    expect(() => {
      assertValidMigrations(MIGRATIONS);
    }).not.toThrow();
  });

  it('rejects empty, unordered, non-integer, and table-dropping lists before touching IndexedDB', async () => {
    const v1 = MIGRATIONS[0];
    if (v1 === undefined) throw new Error('MIGRATIONS is empty');
    const withoutMeta = omit(v1.stores, 'meta');
    const invalid: (readonly Migration[])[] = [
      [],
      [v1, { version: 1, stores: {} }],
      [v1, { version: 1.5, stores: {} }],
      [{ version: 0, stores: v1.stores }],
      [{ version: 1, stores: withoutMeta }],
      [v1, { version: 2, stores: { meta: null } }],
    ];
    for (const migrations of invalid) {
      await expectLedgerError(openLedger(uniqueDbName('invalid'), migrations), 'invalid_migrations');
    }
  });
});
