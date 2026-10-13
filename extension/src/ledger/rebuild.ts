/**
 * The ledger rebuilt so that Chrome's files keep no older copy of any row (Sprint 6 close, security review SEC-1).
 * Chrome keeps IndexedDB in LevelDB files. A put adds a new version of the row; the version it replaces stays in the
 * files until a compaction rewrites them, and so does what Chrome's own undo log keeps of it. Measured on 2026-10-12
 * (docs/attacks-that-work.md, strategy 13): a ledger of 5,000 plain sends sealed in place kept 1,200 to 2,400 of them
 * readable in its files, after the browser closed too.
 *
 * The ledger lives in a storage bucket of its own, and Chrome deletes a bucket's whole folder of files with it
 * (./place.ts). So, once a job has sealed every row (./crypto-job.ts), the service worker (src/background/rebuild.ts)
 * rebuilds the ledger here:
 *  1. every row of every table is copied as stored into the ledger of the next bucket, which so holds each row once,
 *     and counted; the mark that a rebuild is due stays behind;
 *  2. the next bucket is named the one the ledger is in;
 *  3. the bucket before is deleted, every older copy of a row with its files.
 *
 * Rows are copied through connections without the sealing middleware: a sealed row stays sealed under the same key,
 * and nothing here needs the passphrase. A stop before step 2 leaves the ledger as it was and the rebuild due; a stop
 * after it leaves a bucket no longer named, which the worker's next start deletes (`settleLedgerPlace`), locked or not
 * (Hard Rule 6). Only the service worker, the ledger's one writer, calls these.
 */
import { Dexie, type IndexableType } from 'dexie';

import { DB_NAME } from '../config';
import { REBUILD_PAGE } from '../config-crypto';
import { CRYPTO_KEYS } from './crypto-state';
import type { LedgerDb } from './db';
import { LedgerError } from './errors';
import { MIGRATIONS, openLedger } from './migrations';
import {
  bucketIndexedDb,
  deleteLedgerBucket,
  ledgerBucket,
  ledgerBuckets,
  nameLedgerBucket,
  nextLedgerBucket,
} from './place';

/** The ledger of bucket `bucket`, as stored; the extension's default store's without one. */
const openAsStored = async (bucket?: string): Promise<LedgerDb> =>
  openLedger(DB_NAME, MIGRATIONS, {
    asStored: true,
    ...(bucket === undefined ? {} : { indexedDB: await bucketIndexedDb(bucket) }),
  });

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

/** Every row of `from`'s ledger copied as stored into `to`'s and counted, but the mark that a rebuild is due. */
async function copyInto(from: LedgerDb, to: LedgerDb, leave: readonly string[] = []): Promise<void> {
  await copyRows(from, to);
  const expected = await counts(from);
  for (const key of leave) {
    if ((await to.meta.get(key)) === undefined) continue;
    await to.meta.delete(key);
    expected.set('meta', (expected.get('meta') ?? 1) - 1);
  }
  expectCounts(expected, await counts(to));
}

/** Step 1 (header): the ledger of `from` copied into the next bucket's, which is returned. A half-made one goes first. */
export async function copyLedger(from: string): Promise<string> {
  const to = nextLedgerBucket(from);
  await deleteLedgerBucket(to);
  const ledger = await openAsStored(from);
  try {
    const copy = await openAsStored(to);
    try {
      await copyInto(ledger, copy, [CRYPTO_KEYS.REBUILD]);
    } finally {
      copy.close();
    }
  } finally {
    ledger.close();
  }
  return to;
}

/**
 * Steps 1 to 3 (header). A copy or a naming that fails deletes the half-made bucket, best effort (the next start does
 * otherwise), and leaves the ledger as it was; a deletion of the bucket before that fails leaves it to the next start.
 */
export async function rebuildLedgerPlace(): Promise<void> {
  const from = await ledgerBucket();
  let to: string | undefined;
  try {
    to = await copyLedger(from);
    await nameLedgerBucket(to);
  } catch (error) {
    await deleteLedgerBucket(to ?? nextLedgerBucket(from)).catch(() => undefined);
    throw new LedgerError(
      'rebuild_failed',
      'The ledger was not copied into the next bucket',
      { step: 'copy' },
      {
        cause: error,
      },
    );
  }
  try {
    await deleteLedgerBucket(from);
  } catch (error) {
    throw new LedgerError(
      'rebuild_failed',
      'The bucket before was not deleted',
      { step: 'delete' },
      {
        cause: error,
      },
    );
  }
}

/**
 * A ledger a build before buckets kept in the extension's default store: copied as stored into `bucket`'s, counted,
 * then deleted. Deleting it has Chrome compact its rows away when no other write lands meanwhile, which no released
 * build needs: none kept the ledger there (Decisions [6.close]).
 */
async function moveIntoBucket(bucket: string): Promise<void> {
  const old = await openAsStored();
  try {
    const into = await openAsStored(bucket);
    try {
      await copyInto(old, into);
    } finally {
      into.close();
    }
  } finally {
    old.close();
  }
  await Dexie.delete(DB_NAME);
}

/**
 * At the worker's start, before anything opens the ledger (src/background/rebuild.ts): the bucket the ledger is in
 * named, a ledger kept before buckets moved into it, and every other ledger bucket deleted: one a stop left half
 * copied, or the one before a rebuild a stop cut short after naming the next. Returns what it did.
 */
export async function settleLedgerPlace(): Promise<{ readonly moved: boolean; readonly deleted: number }> {
  const bucket = await ledgerBucket();
  const moved = (await Dexie.getDatabaseNames()).includes(DB_NAME);
  if (moved) await moveIntoBucket(bucket);
  const others = (await ledgerBuckets()).filter((name) => name !== bucket);
  for (const name of others) await deleteLedgerBucket(name);
  return { moved, deleted: others.length };
}
