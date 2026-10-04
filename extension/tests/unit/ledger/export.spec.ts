import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { LedgerDb } from '../../../src/ledger/db';
import { LEDGER_EXPORT_FORMAT, LedgerExport, exportLedger } from '../../../src/ledger/export';
import { INDEX_FIELDS, LEDGER_TABLE_NAMES } from '../../../src/ledger/index-fields';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import {
  putAdapterHealth,
  putCoveragePing,
  putGrant,
  putReceipt,
  putRequest,
  setMeta,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import {
  claimId,
  expectLedgerError,
  makeClaim,
  makeGrant,
  makeHealth,
  makeObservation,
  makePing,
  makeReceipt,
  makeRequest,
  observationId,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

const EXPORTED_AT = '2026-10-01T12:00:00-04:00';
const opened: LedgerDb[] = [];

async function open(prefix: string, migrations = MIGRATIONS): Promise<LedgerDb> {
  const db = await openLedger(uniqueDbName(prefix), migrations);
  opened.push(db);
  return db;
}

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

/** Two of everything, written in the given order (`reverse` flips it) so ordering is exercised. */
async function populate(db: LedgerDb, reverse = false): Promise<void> {
  const order = <T>(items: T[]): T[] => (reverse ? [...items].reverse() : items);
  for (const n of order([2, 1])) {
    await upsertObservation(db, makeObservation({ rowKeyHash: sha(n) }), DEFAULT_POLICY);
    await upsertClaim(db, makeClaim({ rawHash: sha(100 + n) }));
    await putRequest(db, makeRequest({ id: ulid(200 + n) }));
    await putReceipt(db, makeReceipt({ id: ulid(300 + n), agent: n === 1 ? 'muse' : 'claude' }));
  }
  for (const agent of order(['muse', 'chatgpt'] as const)) await putGrant(db, makeGrant({ agent }));
  for (const adapterId of order(['muse', 'gmail'])) await putAdapterHealth(db, makeHealth({ adapterId }));
  const accountless = omit(makePing({ observerId: 'gcal' }), 'accountHash');
  for (const ping of order([makePing(), accountless])) await putCoveragePing(db, ping);
  for (const [key, value] of order<[string, number]>([
    ['retentionDays', 90],
    ['eventsSeen', 3],
  ])) {
    await setMeta(db, key, value);
  }
}

describe('exportLedger', () => {
  it('exports every table as strict domain objects sorted by primary key, with no index fields', async () => {
    const db = await open('export');
    await populate(db, true);
    const exported = await exportLedger(db, { exportedAt: EXPORTED_AT });
    expect(LedgerExport.parse(exported)).toEqual(exported);
    expect(exported).toMatchObject({
      format: LEDGER_EXPORT_FORMAT,
      schemaVersion: MIGRATIONS.at(-1)?.version,
      exportedAt: EXPORTED_AT,
    });
    expect(Object.keys(exported.tables).sort()).toEqual([...LEDGER_TABLE_NAMES].sort());
    const { tables } = exported;
    expect(tables.observations.map((o) => o.id)).toEqual([observationId(1), observationId(2)].sort());
    expect(tables.claims.map((c) => c.id)).toEqual([claimId(101), claimId(102)].sort());
    expect(tables.receipts.map((r) => r.id)).toEqual([ulid(301), ulid(302)]);
    expect(tables.grants.map((g) => g.agent)).toEqual(['chatgpt', 'muse']);
    expect(tables.adapterHealth.map((h) => h.adapterId)).toEqual(['gmail', 'muse']);
    expect(tables.coverage.map((p) => p.observerId)).toEqual(['gcal', 'gmail']);
    expect(tables.meta.map((m) => m.key)).toEqual(['eventsSeen', 'retentionDays']);
    for (const table of LEDGER_TABLE_NAMES) {
      for (const row of tables[table]) {
        for (const field of INDEX_FIELDS[table]) expect(row, `${table}.${field}`).not.toHaveProperty(field);
      }
    }
  });

  it('is deterministic: same ledger content → byte-identical export, whatever the write order', async () => {
    const a = await open('export-a');
    const b = await open('export-b');
    await populate(a);
    await populate(b, true);
    const first = JSON.stringify(await exportLedger(a, { exportedAt: EXPORTED_AT }));
    expect(JSON.stringify(await exportLedger(a, { exportedAt: EXPORTED_AT }))).toBe(first);
    expect(JSON.stringify(await exportLedger(b, { exportedAt: EXPORTED_AT }))).toBe(first);
  });
});

describe('exportLedger: record fields export in a fixed order', () => {
  it('is deterministic for record fields: receipt signals export in sorted key order', async () => {
    const a = await open('export-signals-a');
    const b = await open('export-signals-b');
    await putReceipt(
      a,
      makeReceipt({ signals: { timeProximity: 0.9, counterpartyExact: 1, amountExact: 0 } }),
    );
    await putReceipt(
      b,
      makeReceipt({ signals: { amountExact: 0, timeProximity: 0.9, counterpartyExact: 1 } }),
    );
    const fromA = await exportLedger(a, { exportedAt: EXPORTED_AT });
    expect(JSON.stringify(await exportLedger(b, { exportedAt: EXPORTED_AT }))).toBe(JSON.stringify(fromA));
    expect(Object.keys(fromA.tables.receipts[0]?.signals ?? {})).toEqual([
      'amountExact',
      'counterpartyExact',
      'timeProximity',
    ]);
  });

  it('is deterministic for reason params and grant accounts too', async () => {
    const a = await open('export-records-a');
    const b = await open('export-records-b');
    const params = (ceilingFirst: boolean) =>
      ceilingFirst
        ? { ceilingCents: 5_000, amountCents: 20_000 }
        : { amountCents: 20_000, ceilingCents: 5_000 };
    const ceiling = (ceilingFirst: boolean) =>
      makeReceipt({
        grade: 'OVER_SCOPE',
        ruleId: 'over_ceiling',
        reasons: [{ code: 'ceiling.exceeded', params: params(ceilingFirst) }],
      });
    const accounts = (calendarFirst: boolean) =>
      calendarFirst
        ? { 'gcal.event': [sha(7)], 'gmail.sent': [sha(8)] }
        : { 'gmail.sent': [sha(8)], 'gcal.event': [sha(7)] };
    await putReceipt(a, ceiling(true));
    await putReceipt(b, ceiling(false));
    await putGrant(a, makeGrant({ accounts: accounts(false) }));
    await putGrant(b, makeGrant({ accounts: accounts(true) }));
    const fromA = await exportLedger(a, { exportedAt: EXPORTED_AT });
    expect(JSON.stringify(await exportLedger(b, { exportedAt: EXPORTED_AT }))).toBe(JSON.stringify(fromA));
    expect(Object.keys(fromA.tables.receipts[0]?.reasons[0]?.params ?? {})).toEqual([
      'amountCents',
      'ceilingCents',
    ]);
    expect(Object.keys(fromA.tables.grants[0]?.accounts ?? {})).toEqual(['gcal.event', 'gmail.sent']);
  });
});

describe('exportLedger: an empty ledger and a bad exportedAt', () => {
  it('exports an empty ledger and reports the migrated schema version', async () => {
    const next = (MIGRATIONS.at(-1)?.version ?? 0) + 1;
    const db = await open('export-next', [...MIGRATIONS, { version: next, stores: {} }]);
    const exported = await exportLedger(db, { exportedAt: EXPORTED_AT });
    expect(exported.schemaVersion).toBe(next);
    for (const table of LEDGER_TABLE_NAMES) expect(exported.tables[table]).toEqual([]);
  });

  it('rejects an exportedAt without an offset', async () => {
    const db = await open('export-bad');
    await expectLedgerError(exportLedger(db, { exportedAt: '2026-10-01T12:00:00' }), 'invalid_input');
    await expectLedgerError(exportLedger(db, { exportedAt: 'yesterday' }), 'invalid_input');
  });
});

describe('LedgerExport schema', () => {
  it('rejects an export whose rows carry extra fields (index or smuggled)', async () => {
    const db = await open('export-schema');
    await upsertObservation(db, makeObservation(), DEFAULT_POLICY);
    const exported = await exportLedger(db, { exportedAt: EXPORTED_AT });
    const first = exported.tables.observations[0];
    if (first === undefined) throw new Error('expected one observation');
    const withIndex = {
      ...exported,
      tables: { ...exported.tables, observations: [{ ...first, timeBucket: 1 }] },
    };
    const withBody = { ...exported, tables: { ...exported.tables, observations: [{ ...first, body: 'x' }] } };
    expect(LedgerExport.safeParse(withIndex).success).toBe(false);
    expect(LedgerExport.safeParse(withBody).success).toBe(false);
  });

  it('rejects a wrong format tag or a missing table', () => {
    const tables = Object.fromEntries(LEDGER_TABLE_NAMES.map((table) => [table, []]));
    const valid = { format: LEDGER_EXPORT_FORMAT, schemaVersion: 1, exportedAt: EXPORTED_AT, tables };
    expect(LedgerExport.safeParse(valid).success).toBe(true);
    expect(LedgerExport.safeParse({ ...valid, format: 'other' }).success).toBe(false);
    expect(LedgerExport.safeParse({ ...valid, tables: omit(tables, 'meta') }).success).toBe(false);
  });
});
