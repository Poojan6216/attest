/**
 * Ledger schema migrations.
 *
 * The ledger is versioned by an ordered list of migrations. `openLedger` declares every entry on a fresh
 * Dexie instance (`db.version(v).stores(spec).upgrade(fn)`), in order, and opens it. Dexie applies the
 * missing versions on open: index changes are built by IndexedDB over existing rows, and each `upgrade`
 * runs exactly once, inside the versionchange transaction.
 *
 * Rules for adding a version:
 *  - Append; never edit or remove a shipped entry (installed ledgers replay the list).
 *  - `stores` lists only the tables that change (Dexie inherits the rest); `null` deletes a table.
 *  - A data migration must keep every row parseable by the strict domain schemas, or reads will skip it.
 */
import { type Transaction } from 'dexie';

import { coverageHash } from '../core/receipt';
import { Coverage } from '../core/schema';

import { DB_NAME } from '../config';
import { log } from '../log';
import {
  BATCH_COVERAGES,
  COVERAGE_INTERVALS,
  LedgerDb,
  RECEIPT_INPUTS,
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  STORES_V5,
  STORES_V6,
  STORES_V7,
} from './db';
import { LedgerError } from './errors';
import { LEDGER_TABLE_NAMES, REPLAY_TABLE_NAMES } from './index-fields';

export interface Migration {
  /** Positive integer, strictly greater than the previous entry's version. */
  readonly version: number;
  /** Dexie stores spec for the tables this version adds or changes (`null` deletes a table). */
  readonly stores: Readonly<Record<string, string | null>>;
  /** Optional data migration. Runs once, when an older ledger is upgraded past this version. */
  readonly upgrade?: (tx: Transaction) => Promise<void>;
}

/**
 * v4's data upgrade (db.ts STORES_V4): every stored coverage interval gets its `kind` and `lenMs`, from the epoch-ms
 * fields v2 already stored with it (a row without them never passed toIntervalRow: it is left alone, the strict read
 * skips it as before, and no index lists it); and every stored observation loses `counterpartyTokens`, the derived
 * field of the index v4 drops, which its strict read would otherwise refuse (Hard Rule 5: no evidence lost).
 */
async function upgradeToV4(tx: Transaction): Promise<void> {
  await tx
    .table(COVERAGE_INTERVALS)
    .toCollection()
    .modify((row: Record<string, unknown>) => {
      const { startMs, endMs } = row;
      if (typeof startMs !== 'number' || typeof endMs !== 'number') return;
      row.kind = startMs === endMs ? 'point' : 'span';
      row.lenMs = endMs - startMs;
    });
  await tx
    .table('observations')
    .toCollection()
    .modify((row: Record<string, unknown>) => {
      if ('counterpartyTokens' in row) Reflect.deleteProperty(row, 'counterpartyTokens');
    });
}

/**
 * v7's data upgrade (db.ts STORES_V7; tech review TECH-1): every stored `receiptInputs` row gives its copy of the
 * coverage to `batchCoverages`, keyed by the coverage's hash, and names it by that hash instead. A row whose coverage
 * does not parse is left alone: the strict read skips it, as it did before.
 */
async function upgradeToV7(tx: Transaction): Promise<void> {
  const rows: unknown[] = await tx.table(RECEIPT_INPUTS).toArray();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || !('coverage' in row)) continue;
    const coverage = Coverage.safeParse(row.coverage);
    if (!coverage.success) continue;
    const hash = coverageHash(coverage.data);
    await tx.table(BATCH_COVERAGES).put({ coverageHash: hash, coverage: coverage.data });
    const moved: Record<string, unknown> = { ...row, coverageHash: hash };
    Reflect.deleteProperty(moved, 'coverage');
    await tx.table(RECEIPT_INPUTS).put(moved);
  }
}

/**
 * v1: the eight ledger tables (Sprint 0.6). v2 (Sprint 2.6): receipt indexes for the retention purge and the
 * coverage interval store (db.ts STORES_V2); IndexedDB builds the new receipt indexes over existing rows, and
 * the new table starts empty (no observer wrote coverage before Sprint 2), so v2 needs no data upgrade. v3 (Sprint
 * 2.7): the Calendar snapshot store (db.ts STORES_V3), new and empty, so no data upgrade either. v4 (Sprint 2 close,
 * TECH-1, TECH-13): the coverage intervals' kind and length indexes, derived over every stored interval, and no
 * counterparty-token index on observations, whose derived field leaves every stored row (db.ts STORES_V4). v5 (sprint_3
 * 3.13): the replay records, receipt inputs and policy documents (db.ts STORES_V5), new and empty, so no data upgrade.
 * v6 (sprint_3 3.14): the activity store (db.ts STORES_V6), new and empty too. v7 (Sprint 3 close, TECH-1): each batch's
 * coverage stored once (db.ts STORES_V7), every stored copy moved there by `upgradeToV7`.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, stores: STORES_V1 },
  { version: 2, stores: STORES_V2 },
  { version: 3, stores: STORES_V3 },
  { version: 4, stores: STORES_V4, upgrade: upgradeToV4 },
  { version: 5, stores: STORES_V5 },
  { version: 6, stores: STORES_V6 },
  { version: 7, stores: STORES_V7, upgrade: upgradeToV7 },
];

/** Throws `invalid_migrations` unless versions ascend and every ledger table survives to the last one. */
export function assertValidMigrations(migrations: readonly Migration[]): void {
  if (migrations.length === 0) {
    throw new LedgerError('invalid_migrations', 'The migration list is empty');
  }
  let previous = 0;
  const declared = new Set<string>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previous) {
      throw new LedgerError('invalid_migrations', 'Migration versions must be ascending positive integers', {
        version: migration.version,
        previous,
      });
    }
    previous = migration.version;
    for (const [table, spec] of Object.entries(migration.stores)) {
      if (spec === null) declared.delete(table);
      else declared.add(table);
    }
  }
  const missing = [...LEDGER_TABLE_NAMES, ...REPLAY_TABLE_NAMES].filter((table) => !declared.has(table));
  if (missing.length > 0) {
    throw new LedgerError('invalid_migrations', 'A ledger table is not declared by the migrations', {
      missing: missing.join(','),
    });
  }
}

/**
 * Opens (creating or upgrading as needed) the ledger database.
 * Rejects with `invalid_migrations` before touching IndexedDB, or `open_failed` if IndexedDB refuses.
 */
export async function openLedger(
  name: string = DB_NAME,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<LedgerDb> {
  assertValidMigrations(migrations);
  const db = new LedgerDb(name);
  for (const migration of migrations) {
    const version = db.version(migration.version).stores(migration.stores);
    if (migration.upgrade !== undefined) version.upgrade(migration.upgrade);
  }
  try {
    await db.open();
  } catch (error) {
    log.error('ledger.open_failed', { error, version: latestVersion(migrations) });
    throw new LedgerError('open_failed', 'The ledger database could not be opened', {}, { cause: error });
  }
  return db;
}

function latestVersion(migrations: readonly Migration[]): number {
  return migrations.at(-1)?.version ?? 0;
}
