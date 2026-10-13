/**
 * The ledger's database rebuilt so that Chrome's files keep no older copy of any row (Sprint 6 close, security review
 * SEC-1). Chrome keeps IndexedDB in LevelDB files. A put adds a new version of the row; the version it replaces stays
 * in the files until a compaction rewrites them, and so does what Chrome's own undo log keeps of it. Measured on
 * 2026-10-12 (docs/attacks-that-work.md, strategy 13): a ledger of 5,000 plain sends sealed in place kept 1,200 to 2,400
 * of them readable in its files, after the browser closed too. Chrome compacts a database's whole range when the
 * database is deleted, and, measured, for nothing less: deleting an object store compacts nothing.
 *
 * So, once a job has sealed every row (./crypto-job.ts), the service worker (src/background/rebuild.ts) rebuilds the
 * ledger here:
 *  1. every row of every table is copied as stored into a copy (REBUILD_DB_NAME), counted, and the copy marked whole;
 *  2. the ledger is deleted, so Chrome compacts its range (`deleteAndCompact`), and made again, empty, at its schema;
 *  3. every row is copied back as stored, and counted again;
 *  4. the copy is deleted, and a small database is made and deleted, so Chrome removes the files the compaction left;
 *  5. the mark that a rebuild is due goes from the ledger.
 *
 * Rows are copied through a connection without the sealing middleware: a sealed row stays sealed under the same key,
 * and nothing here needs the passphrase. So a rebuild a stop of the worker cut short is finished at the worker's next
 * start, locked or not (Hard Rule 6). The ledger is deleted only once the copy is marked whole; a copy not marked whole
 * is deleted and made again. Only the service worker, the ledger's one writer, calls these.
 */
import { Dexie, type IndexableType } from 'dexie';

import { DB_NAME } from '../config';
import { FLUSH_DB_NAME, REBUILD_DB_NAME, REBUILD_PAGE } from '../config-crypto';
import { CRYPTO_KEYS } from './crypto-state';
import type { LedgerDb } from './db';
import { LedgerError } from './errors';
import { MIGRATIONS, openLedger } from './migrations';
import { MetaEntry } from './types';

/** The `meta` key the copy carries once it holds every row (step 1); never put back in the ledger. */
const WHOLE = 'rebuild.whole';

const openAsStored = (name: string): Promise<LedgerDb> => openLedger(name, MIGRATIONS, { asStored: true });

/** The keys of a table keyed outside its rows (`++`: numbers), to give back with them; anything else stops the copy. */
function outboundKeys(table: string, keys: readonly IndexableType[]): readonly (string | number)[] {
  const simple = keys.filter(
    (key): key is string | number => typeof key === 'string' || typeof key === 'number',
  );
  if (simple.length !== keys.length) {
    throw new LedgerError('rebuild_failed', 'A key of a table keyed outside its rows is not a number', {
      table,
    });
  }
  return simple;
}

/**
 * Copies every row of every table of `from` into `to`, as stored, one page per transaction, keys kept. Each page is read
 * whole, its rows and its keys in one read each, never a step at a time: a month's ledger copies in seconds, where a
 * cursor's steps took most of a minute (Sprint 6 close, tech review TECH-12).
 */
async function copyRows(from: LedgerDb, to: LedgerDb): Promise<void> {
  for (const { name } of from.tables) {
    const source = from.table<unknown>(name);
    const target = to.table<unknown>(name);
    const { keyPath } = source.schema.primKey;
    // A table keyed outside its rows (`++`) has no key path: null at run time, though Dexie types it undefined.
    const outbound = typeof keyPath !== 'string' && !Array.isArray(keyPath);
    let after: IndexableType | undefined;
    for (;;) {
      const page = (after === undefined ? source.orderBy(':id') : source.where(':id').above(after)).limit(
        REBUILD_PAGE,
      );
      const [values, keys] = await from.transaction('r', source, () =>
        Promise.all([page.toArray(), page.primaryKeys()]),
      );
      if (values.length > 0) {
        await (outbound ? target.bulkPut(values, outboundKeys(name, keys)) : target.bulkPut(values));
      }
      if (values.length < REBUILD_PAGE) break;
      after = keys.at(-1);
    }
  }
}

/** Every table's count of rows. */
async function counts(db: LedgerDb): Promise<Map<string, number>> {
  const each = await Promise.all(db.tables.map(async (table) => [table.name, await table.count()] as const));
  return new Map(each);
}

/** Throws `rebuild_failed` unless `copied` holds exactly as many rows as `expected` in every table. */
function expectCounts(expected: ReadonlyMap<string, number>, copied: ReadonlyMap<string, number>): void {
  for (const [table, count] of expected) {
    if (copied.get(table) !== count) {
      throw new LedgerError('rebuild_failed', 'A table did not copy whole', {
        table,
        expected: count,
        copied: copied.get(table) ?? 0,
      });
    }
  }
}

/** Whether a copy marked whole waits to be put back (header): a rebuild a stop cut short at step 2 or later. */
export async function copyIsWhole(): Promise<boolean> {
  if (!(await Dexie.getDatabaseNames()).includes(REBUILD_DB_NAME)) return false;
  const copy = await openAsStored(REBUILD_DB_NAME);
  try {
    return (await copy.meta.get(WHOLE)) !== undefined;
  } finally {
    copy.close();
  }
}

/** Step 1 (header): every row copied as stored, counted, and the copy marked whole; a copy a stop left is made again. */
export async function copyLedger(): Promise<void> {
  await Dexie.delete(REBUILD_DB_NAME);
  const ledger = await openAsStored(DB_NAME);
  const copy = await openAsStored(REBUILD_DB_NAME);
  try {
    await copyRows(ledger, copy);
    expectCounts(await counts(ledger), await counts(copy));
    await copy.meta.put(MetaEntry.parse({ key: WHOLE, value: true }));
  } finally {
    ledger.close();
    copy.close();
  }
}

/** Makes the small database and writes a row to it, which Chrome holds in memory with the rows before it. */
async function makeFlush(): Promise<void> {
  const flush = new Dexie(FLUSH_DB_NAME);
  flush.version(1).stores({ flush: '' });
  try {
    await flush.table('flush').put(true, 1);
  } finally {
    flush.close();
  }
}

/**
 * Runs `deleting`, a database's deletion, between the making and the deletion of a small database, so that nothing it
 * deleted stays in Chrome's files. Measured (2026-10-12): Chrome compacts a deleted database's range only on the levels
 * of its files that held that range before. Rows still in memory are written to a new file first, and that file is not
 * compacted; a small ledger is all in memory, so all of it stayed. The small database's row goes into that same file,
 * and deleting the small database then compacts the file, with every deleted row in it, away. Delete all data uses it
 * (src/background/settings.ts), and so does the rebuild for the ledger it deletes.
 */
export async function deleteAndCompact(deleting: () => Promise<void>): Promise<void> {
  await makeFlush();
  await deleting();
  await Dexie.delete(FLUSH_DB_NAME);
}

/**
 * Makes and deletes the small database (header, step 4): deleting it has Chrome start a new log and remove the files no
 * longer in use, the ones the compactions before left among them.
 */
export async function flushChromeFiles(): Promise<void> {
  await deleteAndCompact(() => Promise.resolve());
}

/** Deletes a rebuild's copy, whole or not: Delete all data deletes it with the ledger (src/background/settings.ts). */
export async function deleteLedgerCopy(): Promise<void> {
  await Dexie.delete(REBUILD_DB_NAME);
}

/** Steps 2 to 5 (header), from a copy marked whole: the ledger deleted, made again, every row put back. */
export async function restoreLedger(): Promise<void> {
  await deleteAndCompact(() => Dexie.delete(DB_NAME));
  const copy = await openAsStored(REBUILD_DB_NAME);
  const ledger = await openAsStored(DB_NAME);
  try {
    await copyRows(copy, ledger);
    await ledger.meta.delete(WHOLE);
    const expected = await counts(copy);
    expected.set('meta', (expected.get('meta') ?? 1) - 1);
    expectCounts(expected, await counts(ledger));
    copy.close();
    await Dexie.delete(REBUILD_DB_NAME);
    await flushChromeFiles();
    await ledger.meta.delete(CRYPTO_KEYS.REBUILD);
  } finally {
    copy.close();
    ledger.close();
  }
}
