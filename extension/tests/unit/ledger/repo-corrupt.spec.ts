/**
 * Rows on disk are untrusted. A row that fails its strict schema (stale shape, smuggled field, bad hash)
 * is skipped by every read and logged as `ledger.row_invalid` with table + id only: never returned,
 * never thrown to the UI, and its content never reaches the log (Hard Rules 2, 10).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { timeBucketOf, toClaimRow, toCoverageRow, toObservationRow } from '../../../src/ledger/index-fields';
import { openLedger } from '../../../src/ledger/migrations';
import {
  claimsByAgentAndDate,
  getAdapterHealth,
  getClaim,
  getCoveragePing,
  getMeta,
  getObservation,
  observationsByCounterpartyToken,
  observationsByTypeAndBuckets,
  putAdapterHealth,
  putCoveragePing,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import type { LogRecord } from '../../../src/log';
import {
  captureLogs,
  makeClaim,
  makeHealth,
  makeObservation,
  makePing,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

const SECRET = 'sk-live-SEEDED-SECRET-4242';
/** Lowercase and hyphenated: it passes the logger's identifier rule, so only the ledger can keep it out. */
const PASSPHRASE = 'correct-horse-battery-staple';

let db: LedgerDb;
let logs: { records: LogRecord[]; restore: () => void };

beforeEach(async () => {
  db = await openLedger(uniqueDbName('corrupt'));
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  db.close();
});

/** Writes rows straight to the table, bypassing the repo's validation (what a buggy build might do). */
async function writeRaw(table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  await db.table<Record<string, unknown>, unknown>(table).bulkPut([...rows]);
}

async function seedObservations(): Promise<void> {
  const valid = makeObservation();
  await upsertObservation(db, valid);
  await writeRaw('observations', [
    { ...toObservationRow(makeObservation({ id: ulid(2), contentHash: sha(2) })), body: SECRET },
    { ...toObservationRow(makeObservation({ id: ulid(3), contentHash: sha(3) })), contentHash: 'zz' },
  ]);
}

function invalidRowEvents(): LogRecord[] {
  return logs.records.filter((record) => record.event === 'ledger.row_invalid');
}

function events(name: string): [unknown, unknown][] {
  return logs.records
    .filter((record) => record.event === name)
    .map((record) => [record.fields.table, record.fields.id]);
}

describe('reads skip corrupt rows', () => {
  it('index queries return only valid rows and log each skipped row by table and id', async () => {
    await seedObservations();
    const bucket = timeBucketOf(makeObservation().occurredAt);
    const found = await observationsByTypeAndBuckets(db, 'email.sent', bucket, bucket);
    expect(found).toEqual([makeObservation()]);
    expect(invalidRowEvents().map((record) => [record.level, record.fields.table, record.fields.id])).toEqual(
      [
        ['warn', 'observations', ulid(2)],
        ['warn', 'observations', ulid(3)],
      ],
    );
    expect(JSON.stringify(logs.records)).not.toContain(SECRET);
    expect(await observationsByCounterpartyToken(db, 'alice@example.com')).toEqual([makeObservation()]);
  });

  it('a get of a corrupt row returns undefined instead of throwing', async () => {
    await seedObservations();
    await writeRaw('meta', [{ key: 'retentionDays', value: { days: 90 } }]);
    expect(await getObservation(db, ulid(2))).toBeUndefined();
    expect(await getMeta(db, 'retentionDays')).toBeUndefined();
    expect(invalidRowEvents().map((record) => record.fields.table)).toEqual(['observations', 'meta']);
  });

  it('the export skips corrupt rows, so it never carries smuggled content', async () => {
    await seedObservations();
    const exported = await exportLedger(db, { exportedAt: '2026-10-01T12:00:00Z' });
    expect(exported.tables.observations).toEqual([makeObservation()]);
    expect(JSON.stringify(exported)).not.toContain(SECRET);
    expect(invalidRowEvents()).toHaveLength(2);
  });

  it('a valid write replaces a corrupt latest-wins row instead of being blocked by it', async () => {
    await writeRaw('adapterHealth', [
      { adapterId: 'muse', status: 'MAYBE', checkedAt: '2099-01-01T00:00:00Z' },
    ]);
    expect(await putAdapterHealth(db, makeHealth())).toEqual({ written: true });
    expect(await getAdapterHealth(db, 'muse')).toEqual(makeHealth());
    // The logger keeps only lowercase identifiers: the camelCase table name must still be readable.
    expect(events('ledger.row_invalid')).toEqual([['adapter_health', 'muse']]);
  });

  it('a valid ping replaces a corrupt coverage row with a later lastSyncAt', async () => {
    await writeRaw('coverage', [{ ...toCoverageRow(makePing()), lastSyncAt: '2099-01-01T00:00:00Z', x: 1 }]);
    expect(await putCoveragePing(db, makePing())).toEqual({ written: true });
    expect(await getCoveragePing(db, 'gmail', sha(900))).toEqual(makePing());
  });

  it('logs a malformed id as null, never echoing what a corrupt row holds in its id field', async () => {
    await writeRaw('observations', [{ ...toObservationRow(makeObservation()), id: PASSPHRASE }]);
    await writeRaw('grants', [{ agent: PASSPHRASE, allowedTypes: 'all' }]);
    const exported = await exportLedger(db, { exportedAt: '2026-10-01T12:00:00Z' });
    expect(exported.tables.observations).toEqual([]);
    expect(exported.tables.grants).toEqual([]);
    expect(events('ledger.row_invalid')).toEqual([
      ['observations', null],
      ['grants', null],
    ]);
    expect(JSON.stringify(logs.records)).not.toContain(PASSPHRASE);
  });

  // SECURITY-1: adapter, observer and meta ids are only checked as non-empty strings before logging, so the
  // logger itself must refuse an identifier-shaped id that is not one of ours.
  it('a corrupt adapterHealth, coverage or meta row keyed by content-shaped text never prints that key', async () => {
    await writeRaw('adapterHealth', [{ adapterId: PASSPHRASE, status: 'MAYBE' }]);
    await writeRaw('coverage', [{ ...toCoverageRow(makePing()), observerId: 'perpetua.villanueva', x: 1 }]);
    await writeRaw('meta', [{ key: 'k7pq2vxw9mzr4tnb8hyd', value: { smuggled: true } }]);
    await exportLedger(db, { exportedAt: '2026-10-01T12:00:00Z' });
    const ids = events('ledger.row_invalid').map(([, id]) => id);
    expect(ids).toEqual(['[redacted len=28]', '[redacted len=19]', '[redacted len=20]']);
    const printed = JSON.stringify(logs.records);
    for (const secret of [PASSPHRASE, 'perpetua.villanueva', 'k7pq2vxw9mzr4tnb8hyd']) {
      expect(printed).not.toContain(secret);
    }
  });
});

describe('idempotent upserts never treat an unreadable row as already stored', () => {
  it('a valid observation replaces an unreadable row holding its contentHash', async () => {
    // An older build stored a row today's strict schema rejects (subjectHint over its 80-char cap).
    await writeRaw('observations', [{ ...toObservationRow(makeObservation()), subjectHint: 'x'.repeat(81) }]);
    const fresh = makeObservation({ id: ulid(2) });
    expect(await upsertObservation(db, fresh)).toEqual({ id: ulid(2), inserted: true });
    expect(await getObservation(db, ulid(2))).toEqual(fresh);
    expect(await observationsByCounterpartyToken(db, 'alice@example.com')).toEqual([fresh]);
    expect(await db.observations.count()).toBe(1);
    expect(events('ledger.row_replaced')).toEqual([['observations', ulid(1)]]);
    // Once replaced, the hash is idempotent again.
    expect(await upsertObservation(db, makeObservation({ id: ulid(3) }))).toEqual({
      id: ulid(2),
      inserted: false,
    });
  });

  it('a valid claim replaces an unreadable row holding its rawHash', async () => {
    await writeRaw('claims', [{ ...toClaimRow(makeClaim()), agent: 'gemini' }]);
    const fresh = makeClaim({ id: ulid(102) });
    expect(await upsertClaim(db, fresh)).toEqual({ id: ulid(102), inserted: true });
    expect(await getClaim(db, ulid(102))).toEqual(fresh);
    expect(await claimsByAgentAndDate(db, 'muse', '2026-10-01')).toEqual([fresh]);
    expect(await db.claims.count()).toBe(1);
  });

  it('a valid write replaces an unreadable row under its own id instead of raising id_conflict', async () => {
    const stale = { ...toObservationRow(makeObservation({ contentHash: sha(9) })), source: 'outlook' };
    await writeRaw('observations', [stale]);
    expect(await upsertObservation(db, makeObservation())).toEqual({ id: ulid(1), inserted: true });
    expect(await getObservation(db, ulid(1))).toEqual(makeObservation());
    expect(await db.observations.count()).toBe(1);
  });
});
