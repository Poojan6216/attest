/**
 * Full ledger export: the user's "download my data", the input of `attest replay`, and what the
 * @mandatory secret-seed test (task 0.5) dumps to prove nothing secret was stored.
 *
 * The export holds ONLY strict, Zod-valid domain objects: derived index fields are stripped and rows that
 * fail their schema are skipped (and logged by id). It is deterministic: one read transaction (a consistent
 * snapshot), each table in primary-key order, each object's keys in schema order (record keys sorted), and
 * the export time is passed in by the caller (no clock here).
 */
import { z } from 'zod';

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

/**
 * `signals` is a record, and Zod keeps a record's keys in the order they were written, so two ledgers with
 * the same receipt could export different bytes. Sorting its keys keeps the export deterministic.
 */
function canonicalReceipt(receipt: Receipt): Receipt {
  const sorted = Object.entries(receipt.signals).sort(([a], [b]) => byCodeUnit(a, b));
  return { ...receipt, signals: Object.fromEntries(sorted) };
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
      grants: readRows('grants', Grant, await db.grants.toArray()),
      receipts: readRows('receipts', Receipt, await db.receipts.toArray()).map(canonicalReceipt),
      adapterHealth: readRows('adapterHealth', AdapterHealth, await db.adapterHealth.toArray()),
      coverage: readRows('coverage', CoveragePing, await db.coverage.toArray()),
      meta: readRows('meta', MetaEntry, await db.meta.toArray()),
    },
  }));
}
