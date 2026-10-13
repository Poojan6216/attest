import 'fake-indexeddb/auto';
/**
 * Rebuilding the ledger's database (src/ledger/rebuild.ts; Sprint 6 close, security review SEC-1): every row of every
 * table put back exactly as stored, keys and bytes alike, over more rows than one page; a copy marked whole finishes a
 * rebuild a stop cut short after the ledger was deleted, or while its rows were going back; a copy a stop left
 * unmarked is never trusted, but made again; and nothing is left behind: no copy, no flush database, no mark of the
 * copy in the ledger, no rebuild due.
 */
import { Dexie, type Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DB_NAME } from '../../../src/config';
import { FLUSH_DB_NAME, REBUILD_DB_NAME, REBUILD_PAGE } from '../../../src/config-crypto';
import { CRYPTO_KEYS } from '../../../src/ledger/crypto-state';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import {
  copyIsWhole,
  copyLedger,
  deleteLedgerCopy,
  flushChromeFiles,
  restoreLedger,
} from '../../../src/ledger/rebuild';

type Entry = readonly [key: unknown, value: unknown];
type Stored = Record<string, Entry[]>;

const openAsStored = (name: string) => openLedger(name, MIGRATIONS, { asStored: true });

/** Every table's rows as IndexedDB holds them, with their keys, in key order. */
async function stored(name: string): Promise<Stored> {
  const db = await openAsStored(name);
  try {
    const tables: Stored = {};
    for (const { name: table } of db.tables) {
      const entries: Entry[] = [];
      await db
        .table<unknown>(table)
        .orderBy(':id')
        .each((value, cursor) => {
          entries.push([cursor.primaryKey, value]);
        });
      tables[table] = entries;
    }
    return tables;
  } finally {
    db.close();
  }
}

/** Row `n` of `table`: its key and unique fields set, the rest a sealed value with bytes in it. */
function rowFor(table: Table, n: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    sealed: {
      k: 'aaaaaaaaaaaa',
      n: Uint8Array.of(n % 256, 7, 9),
      c: Uint8Array.from({ length: 40 }, (_, i) => i ^ n),
    },
    note: `invented ${table.name} ${String(n)}`,
  };
  const { keyPath } = table.schema.primKey;
  for (const field of typeof keyPath === 'string' ? [keyPath] : (keyPath ?? []))
    row[field] = `${field}-${String(n)}`;
  for (const index of table.schema.indexes) {
    if (index.unique === true && typeof index.keyPath === 'string')
      row[index.keyPath] = `${index.name}-${String(n)}`;
  }
  return row;
}

/** The keys of the rows of a table keyed outside its rows (`++`): not what a new table would number them. */
const OUTBOUND_KEYS = [10, 20, 30];

/** Fills every table: three rows each, `observations` more than two pages, and the rebuild marked due. */
async function seed(): Promise<void> {
  const db = await openAsStored(DB_NAME);
  try {
    for (const table of db.tables) {
      const rows = table.name === 'observations' ? REBUILD_PAGE * 2 + 7 : 3;
      const values = Array.from({ length: rows }, (_, n) => rowFor(table, n + 1));
      const { keyPath } = table.schema.primKey;
      await (typeof keyPath === 'string' || Array.isArray(keyPath)
        ? table.bulkAdd(values)
        : table.bulkAdd(values, OUTBOUND_KEYS));
    }
    await db.meta.put({ key: CRYPTO_KEYS.REBUILD, value: true });
  } finally {
    db.close();
  }
}

/** What the ledger holds once rebuilt: what it held, without the rebuild due. */
function withoutRebuildDue(before: Stored): Stored {
  return { ...before, meta: (before.meta ?? []).filter(([key]) => key !== CRYPTO_KEYS.REBUILD) };
}

async function deleteAll(): Promise<void> {
  await Promise.all([DB_NAME, REBUILD_DB_NAME, FLUSH_DB_NAME].map((name) => Dexie.delete(name)));
}

beforeEach(async () => {
  await deleteAll();
  await seed();
});

afterEach(deleteAll);

describe('rebuilding the ledger', () => {
  it('puts back every row of every table as stored, keys and bytes alike, and leaves nothing behind', async () => {
    const before = await stored(DB_NAME);
    expect(before.observations).toHaveLength(REBUILD_PAGE * 2 + 7);
    expect(before.coverageIntervals?.map(([key]) => key)).toEqual(OUTBOUND_KEYS);

    await copyLedger();
    expect(await copyIsWhole()).toBe(true);
    await restoreLedger();

    expect(await stored(DB_NAME)).toEqual(withoutRebuildDue(before));
    expect(await Dexie.getDatabaseNames()).toEqual([DB_NAME]);
  });

  it('reports no whole copy when there is none, and deletes one on Delete all data', async () => {
    expect(await copyIsWhole()).toBe(false);
    await copyLedger();
    await deleteLedgerCopy();
    expect(await copyIsWhole()).toBe(false);
    expect(await Dexie.getDatabaseNames()).toEqual([DB_NAME]);
  });

  it("flushes Chrome's files with a database it deletes at once", async () => {
    await flushChromeFiles();
    expect(await Dexie.getDatabaseNames()).toEqual([DB_NAME]);
  });
});

describe('a rebuild a stop cut short', () => {
  it('finishes from a whole copy after a stop that deleted the ledger', async () => {
    const before = await stored(DB_NAME);
    await copyLedger();
    await Dexie.delete(DB_NAME);

    expect(await copyIsWhole()).toBe(true);
    await restoreLedger();
    expect(await stored(DB_NAME)).toEqual(withoutRebuildDue(before));
  });

  it('finishes from a whole copy after a stop while its rows were going back', async () => {
    const before = await stored(DB_NAME);
    await copyLedger();
    await Dexie.delete(DB_NAME);
    const half = await openAsStored(DB_NAME);
    await half.observations.bulkAdd(
      (before.observations ?? []).slice(0, REBUILD_PAGE).map(([, value]) => value as never),
    );
    half.close();

    await restoreLedger();
    expect(await stored(DB_NAME)).toEqual(withoutRebuildDue(before));
  });

  it('never trusts a copy a stop left unmarked: it is made again from the ledger', async () => {
    const before = await stored(DB_NAME);
    const stale = await openAsStored(REBUILD_DB_NAME);
    await stale.requests.add(rowFor(stale.requests, 99) as never);
    stale.close();
    expect(await copyIsWhole()).toBe(false);

    await copyLedger();
    await restoreLedger();
    expect(await stored(DB_NAME)).toEqual(withoutRebuildDue(before));
  });
});
