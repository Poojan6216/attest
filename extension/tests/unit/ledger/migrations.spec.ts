import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { COVERAGE_INTERVALS, type LedgerDb } from '../../../src/ledger/db';
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
import { Observation, Ulid } from '../../../src/ledger/types';
import {
  captureLogs,
  expectLedgerError,
  makeClaim,
  makeObservation,
  omit,
  pinClock,
  releaseClock,
  uniqueDbName,
} from './fixtures';

/** The seeded observation seen again later: same contentHash, so the same id (§10 v1.3). */
const resighting = () => makeObservation({ observedAt: '2026-10-01T11:00:00-04:00' });
const OBSERVATIONS_V1 = 'id, &contentHash, [type+timeBucket], *counterpartyTokens, occurredAt';
/** The shipped schema version, and the next one the framework tests append (v2 shipped in Sprint 2.6). */
const SHIPPED = MIGRATIONS.at(-1)?.version ?? 0;
const NEXT = SHIPPED + 1;

const opened: LedgerDb[] = [];

async function open(name: string, migrations: readonly Migration[] = MIGRATIONS): Promise<LedgerDb> {
  const db = await openLedger(name, migrations);
  opened.push(db);
  return db;
}

async function seedShipped(name: string): Promise<void> {
  const db = await open(name);
  await upsertObservation(db, makeObservation(), DEFAULT_POLICY);
  await upsertClaim(db, makeClaim());
  await setMeta(db, 'lastPurgeAt', '2026-09-30T00:00:00Z');
  db.close();
}

function indexOf(db: LedgerDb, table: string, name: string) {
  return db.table(table).schema.indexes.find((index) => index.name === name);
}

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

describe('the shipped schema', () => {
  it('opens at the shipped version with every ledger table (the coverage intervals and Calendar snapshots included)', async () => {
    const db = await open(uniqueDbName('v1'));
    expect(db.verno).toBe(SHIPPED);
    expect(SHIPPED).toBe(4);
    expect(LEDGER_TABLE_NAMES).toContain(COVERAGE_INTERVALS);
    expect(db.tables.map((table) => table.name).sort()).toEqual([...LEDGER_TABLE_NAMES].sort());
  });

  it('declares the tech_reviewer indexes (unique hashes, compound, multiEntry)', async () => {
    const db = await open(uniqueDbName('v1-idx'));
    expect(indexOf(db, 'observations', 'contentHash')?.unique).toBe(true);
    expect(indexOf(db, 'claims', 'rawHash')?.unique).toBe(true);
    expect(indexOf(db, 'observations', '[type+timeBucket]')?.compound).toBe(true);
    // v4 (TECH-13): the v1 counterparty-token index is gone; candidate retrieval reads [type+timeBucket].
    expect(indexOf(db, 'observations', 'counterpartyTokens')).toBeUndefined();
    for (const table of ['claims', 'requests', 'receipts']) {
      expect(indexOf(db, table, '[agent+date]')?.compound, table).toBe(true);
    }
    expect(db.coverage.schema.primKey.compound).toBe(true);
    expect(db.coverage.schema.primKey.keyPath).toEqual(['observerId', 'accountKey']);
    expect(db.grants.schema.primKey.keyPath).toBe('agent');
  });
});

describe('shipped → next migrations', () => {
  it('a no-op next version preserves every row and bumps verno', async () => {
    const name = uniqueDbName('noop');
    await seedShipped(name);
    const db = await open(name, [...MIGRATIONS, { version: NEXT, stores: {} }]);
    expect(db.verno).toBe(NEXT);
    expect(await getObservation(db, makeObservation().id)).toEqual(makeObservation());
    expect(await getClaim(db, makeClaim().id)).toEqual(makeClaim());
    expect(await getMeta(db, 'lastPurgeAt')).toBe('2026-09-30T00:00:00Z');
  });

  it('a next version that adds an index builds it over existing rows', async () => {
    const name = uniqueDbName('add-index');
    await seedShipped(name);
    const db = await open(name, [
      ...MIGRATIONS,
      { version: NEXT, stores: { observations: `${OBSERVATIONS_V1}, source` } },
    ]);
    expect(indexOf(db, 'observations', 'source')).toBeDefined();
    const rows = await db.observations.where('source').equals('gmail.sent').toArray();
    expect(rows.map((row) => row.id)).toEqual([makeObservation().id]);
    // Pre-existing unique index still enforced after the upgrade (a re-sighting is not inserted).
    expect((await upsertObservation(db, resighting(), DEFAULT_POLICY)).inserted).toBe(false);
  });
});

describe('shipped → next migrations: upgrade functions', () => {
  it('runs an upgrade function exactly once', async () => {
    const name = uniqueDbName('upgrade-once');
    await seedShipped(name);
    let runs = 0;
    const v2: Migration = {
      version: NEXT,
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

  it('a failing upgrade rejects with open_failed, logs, and leaves the shipped data intact', async () => {
    const name = uniqueDbName('upgrade-fails');
    await seedShipped(name);
    const logs = captureLogs();
    try {
      const failing: Migration = {
        version: NEXT,
        stores: {},
        upgrade: () => Promise.reject(new Error('backfill exploded')),
      };
      await expectLedgerError(openLedger(name, [...MIGRATIONS, failing]), 'open_failed');
    } finally {
      logs.restore();
    }
    expect(logs.records.map((record) => record.event)).toContain('ledger.open_failed');
    const db = await open(name);
    expect(db.verno).toBe(SHIPPED);
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
      [v1, { version: NEXT, stores: { meta: null } }],
    ];
    for (const migrations of invalid) {
      await expectLedgerError(openLedger(uniqueDbName('invalid'), migrations), 'invalid_migrations');
    }
  });
});

describe('shipped → next migrations: the unique contentHash index', () => {
  it('still refuses a raw row that reuses a contentHash under another id', async () => {
    // §10 v1.3 makes such a row invalid input for upsertObservation; the store's own index refuses it too.
    const name = uniqueDbName('unique-hash');
    await seedShipped(name);
    const db = await open(name, [
      ...MIGRATIONS,
      { version: NEXT, stores: { observations: `${OBSERVATIONS_V1}, source` } },
    ]);
    const [row] = await db.observations.toArray();
    if (row === undefined) throw new Error('expected the seeded observation');
    await expect(db.observations.add({ ...row, id: Ulid.parse(makeClaim().id) })).rejects.toMatchObject({
      name: 'ConstraintError',
    });
  });
});
