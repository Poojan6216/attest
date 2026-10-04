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

import { DB_NAME } from '../config';
import { log } from '../log';
import { LedgerDb, STORES_V1, STORES_V2 } from './db';
import { LedgerError } from './errors';
import { LEDGER_TABLE_NAMES } from './index-fields';

export interface Migration {
  /** Positive integer, strictly greater than the previous entry's version. */
  readonly version: number;
  /** Dexie stores spec for the tables this version adds or changes (`null` deletes a table). */
  readonly stores: Readonly<Record<string, string | null>>;
  /** Optional data migration. Runs once, when an older ledger is upgraded past this version. */
  readonly upgrade?: (tx: Transaction) => Promise<void>;
}

/**
 * v1: the eight ledger tables (Sprint 0.6). v2 (Sprint 2.6): receipt indexes for the retention purge and the
 * coverage interval store (db.ts STORES_V2); IndexedDB builds the new receipt indexes over existing rows, and
 * the new table starts empty (no observer wrote coverage before Sprint 2), so v2 needs no data upgrade.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, stores: STORES_V1 },
  { version: 2, stores: STORES_V2 },
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
  const missing = LEDGER_TABLE_NAMES.filter((table) => !declared.has(table));
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
