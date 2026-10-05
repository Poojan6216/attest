/**
 * Full ledger export: the user's "download my data", the input of `attest replay`, and what the
 * @mandatory secret-seed test (task 0.5) dumps to prove nothing secret was stored.
 *
 * The export holds ONLY strict, Zod-valid domain objects: derived index fields are stripped and rows that
 * fail their schema are skipped (and logged by id). It is deterministic: one read transaction (a consistent
 * snapshot), each table in primary-key order, each object's keys in schema order (record keys sorted), and
 * the export time is passed in by the caller (no clock here).
 *
 * Every ledger table is exported (LEDGER_TABLE_NAMES), the coverage intervals and Calendar snapshots included
 * (Sprint 2.7): the user's data is everything the ledger holds. Those two default to empty when an export from
 * before Sprint 2.7 is read, so older exports still parse for `attest replay`, which never reads them.
 */
import { z } from 'zod';

import { CalendarRecord } from './calendar-snapshots';
import { readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import {
  AdapterHealth,
  Claim,
  CoveragePing,
  Grant,
  IsoTs,
  MetaEntry,
  Observation,
  ObserverCoverage,
  Receipt,
  Request,
} from './types';

export const LEDGER_EXPORT_FORMAT = 'attest-ledger';

export const LedgerExport = z.strictObject({
  format: z.literal(LEDGER_EXPORT_FORMAT),
  /** The ledger's Dexie schema version at export time. */
  schemaVersion: z.number().int().positive(),
  exportedAt: IsoTs,
  tables: z.strictObject({
    requests: z.array(Request),
    claims: z.array(Claim),
    observations: z.array(Observation),
    grants: z.array(Grant),
    receipts: z.array(Receipt),
    adapterHealth: z.array(AdapterHealth),
    coverage: z.array(CoveragePing),
    meta: z.array(MetaEntry),
    coverageIntervals: z.array(ObserverCoverage).default([]),
    calendarSnapshots: z.array(CalendarRecord).default([]),
  }),
});

export type LedgerExport = z.infer<typeof LedgerExport>;

export interface ExportOptions {
  /** When the export was taken (ISO 8601 with offset). The caller reads the clock, not the ledger. */
  readonly exportedAt: string;
}

function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** A record with its keys in UTF-16 code-unit order. */
function sortedRecord<V>(record: Readonly<Record<string, V>>): Record<string, V> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => byCodeUnit(a, b)));
}

/**
 * Records (`signals`, each reason's `params`) keep the key order they were written in, so two ledgers with
 * the same receipt could export different bytes. Sorting their keys keeps the export deterministic.
 */
function canonicalReceipt(receipt: Receipt): Receipt {
  return {
    ...receipt,
    reasons: receipt.reasons.map((reason) => ({ ...reason, params: sortedRecord(reason.params) })),
    signals: sortedRecord(receipt.signals),
  };
}

/** `accounts` is a record too: its sources export in sorted order. */
function canonicalGrant(grant: Grant): Grant {
  if (grant.accounts === undefined) return grant;
  return { ...grant, accounts: sortedRecord(grant.accounts) };
}

export async function exportLedger(db: LedgerDb, options: ExportOptions): Promise<LedgerExport> {
  const exportedAt = IsoTs.safeParse(options.exportedAt);
  if (!exportedAt.success) {
    throw new LedgerError('invalid_input', 'exportedAt must be ISO 8601 with an offset', {
      field: 'exportedAt',
    });
  }
  return db.transaction('r', db.tables, async (): Promise<LedgerExport> => ({
    format: LEDGER_EXPORT_FORMAT,
    schemaVersion: db.verno,
    exportedAt: exportedAt.data,
    tables: {
      requests: readRows('requests', Request, await db.requests.toArray()),
      claims: readRows('claims', Claim, await db.claims.toArray()),
      observations: readRows('observations', Observation, await db.observations.toArray()),
      grants: readRows('grants', Grant, await db.grants.toArray()).map(canonicalGrant),
      receipts: readRows('receipts', Receipt, await db.receipts.toArray()).map(canonicalReceipt),
      adapterHealth: readRows('adapterHealth', AdapterHealth, await db.adapterHealth.toArray()),
      coverage: readRows('coverage', CoveragePing, await db.coverage.toArray()),
      meta: readRows('meta', MetaEntry, await db.meta.toArray()),
      coverageIntervals: readRows(
        'coverageIntervals',
        ObserverCoverage,
        await db.coverageIntervals.toArray(),
      ),
      calendarSnapshots: readRows('calendarSnapshots', CalendarRecord, await db.calendarSnapshots.toArray()),
    },
  }));
}
