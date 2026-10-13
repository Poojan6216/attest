import 'fake-indexeddb/auto';
/**
 * Rebuilding the ledger into its next storage bucket (src/ledger/rebuild.ts; Sprint 6 close, security review SEC-1), on
 * the unit run's fake buckets (tests/unit/storage-buckets-setup.ts): every row of every table copied exactly as stored,
 * keys and bytes alike, over more rows than one page, into the next bucket, which is named, and the bucket before
 * deleted, so nothing is left: no other bucket, no mark that a rebuild is due. A stop at each step is settled at the
 * next start: a half-made copy is never trusted, but deleted, the ledger as it was; a named copy is kept, the bucket
 * before deleted. A copy that fails leaves the ledger where it was. A ledger a build before buckets kept in the default
 * store is moved into the bucket, as stored, and deleted there.
 */
import { Dexie, type Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DB_NAME } from '../../../src/config';
import { REBUILD_PAGE } from '../../../src/config-crypto';
import { CRYPTO_KEYS } from '../../../src/ledger/crypto-state';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import {
  bucketIndexedDb,
  FIRST_LEDGER_BUCKET,
  ledgerBucket,
  ledgerBuckets,
  nameLedgerBucket,
} from '../../../src/ledger/place';
import { copyLedger, rebuildLedgerPlace, settleLedgerPlace } from '../../../src/ledger/rebuild';
import { deleteLedger } from '../../../src/ledger/shared';
import { fakeStorageBuckets } from '../storage-buckets-setup';
import { expectLedgerError } from './fixtures';

type Entry = readonly [key: unknown, value: unknown];
type Stored = Record<string, Entry[]>;

const NEXT = 'ledger-2';

/** The ledger of `bucket` as stored; the default store's without one. */
const openAsStored = async (bucket?: string) =>
  openLedger(DB_NAME, MIGRATIONS, {
    asStored: true,
    ...(bucket === undefined ? {} : { indexedDB: await bucketIndexedDb(bucket) }),
  });

/** Every table's rows as IndexedDB holds them, with their keys, in key order. */
async function stored(bucket?: string): Promise<Stored> {
  const db = await openAsStored(bucket);
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

/** Fills every table of `bucket`'s ledger: three rows each, `observations` more than two pages, the rebuild due. */
async function seed(bucket?: string): Promise<void> {
  const db = await openAsStored(bucket);
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

beforeEach(async () => {
  fakeBrowser.reset();
  await deleteLedger();
  await seed(await ledgerBucket());
});

afterEach(deleteLedger);

describe('rebuilding the ledger', () => {
  it('copies every row of every table as stored into the next bucket, names it, and deletes the one before', async () => {
    const before = await stored(FIRST_LEDGER_BUCKET);
    expect(before.observations).toHaveLength(REBUILD_PAGE * 2 + 7);
    expect(before.coverageIntervals?.map(([key]) => key)).toEqual(OUTBOUND_KEYS);

    await rebuildLedgerPlace();

    expect(await ledgerBucket()).toBe(NEXT);
    expect(await ledgerBuckets()).toEqual([NEXT]);
    expect(await stored(NEXT)).toEqual(withoutRebuildDue(before));
    expect(await Dexie.getDatabaseNames()).toEqual([]);
  });

  it('never trusts a bucket a stop left half made: it is made again from the ledger', async () => {
    const before = await stored(FIRST_LEDGER_BUCKET);
    const stale = await openAsStored(NEXT);
    await stale.requests.add(rowFor(stale.requests, 99) as never);
    stale.close();

    await rebuildLedgerPlace();
    expect(await stored(NEXT)).toEqual(withoutRebuildDue(before));
  });

  it('leaves the ledger where it was when the next bucket does not open, and that bucket gone', async () => {
    const before = await stored(FIRST_LEDGER_BUCKET);
    const open = fakeStorageBuckets.open.bind(fakeStorageBuckets);
    const opened = vi
      .spyOn(fakeStorageBuckets, 'open')
      .mockImplementation((name) => (name === NEXT ? Promise.reject(new Error('no bucket')) : open(name)));

    await expectLedgerError(rebuildLedgerPlace(), 'rebuild_failed');
    opened.mockRestore();
    expect(await ledgerBucket()).toBe(FIRST_LEDGER_BUCKET);
    expect(await ledgerBuckets()).toEqual([FIRST_LEDGER_BUCKET]);
    expect(await stored(FIRST_LEDGER_BUCKET)).toEqual(before);
  });

  it('refuses a copy whose counts differ from the ledger, which stays where it was', async () => {
    const before = await stored(FIRST_LEDGER_BUCKET);
    // A next bucket that will not go, an extra row in it: the copy counts one row more than the ledger holds.
    const stale = await openAsStored(NEXT);
    await stale.requests.add(rowFor(stale.requests, 99) as never);
    stale.close();
    const kept = vi.spyOn(fakeStorageBuckets, 'delete').mockResolvedValue(undefined);

    await expectLedgerError(rebuildLedgerPlace(), 'rebuild_failed');
    kept.mockRestore();
    expect(await ledgerBucket()).toBe(FIRST_LEDGER_BUCKET);
    expect(await stored(FIRST_LEDGER_BUCKET)).toEqual(before);
  });
});

describe('a rebuild a stop cut short, settled at the next start', () => {
  it('after the copy, before it was named: the copy is deleted, the ledger as it was, the rebuild still due', async () => {
    const before = await stored(FIRST_LEDGER_BUCKET);
    expect(await copyLedger(FIRST_LEDGER_BUCKET)).toBe(NEXT);

    expect(await settleLedgerPlace()).toEqual({ moved: false, deleted: 1 });
    expect(await ledgerBuckets()).toEqual([FIRST_LEDGER_BUCKET]);
    expect(await stored(FIRST_LEDGER_BUCKET)).toEqual(before);
  });

  it('after the copy was named, before the bucket before was deleted: that bucket is deleted', async () => {
    const before = await stored(FIRST_LEDGER_BUCKET);
    await nameLedgerBucket(await copyLedger(FIRST_LEDGER_BUCKET));

    expect(await settleLedgerPlace()).toEqual({ moved: false, deleted: 1 });
    expect(await ledgerBuckets()).toEqual([NEXT]);
    expect(await stored(NEXT)).toEqual(withoutRebuildDue(before));
  });

  it('with nothing to settle, does nothing', async () => {
    expect(await settleLedgerPlace()).toEqual({ moved: false, deleted: 0 });
    expect(await ledgerBuckets()).toEqual([FIRST_LEDGER_BUCKET]);
  });
});

describe('a ledger a build before buckets kept in the default store', () => {
  it('is moved into the bucket named, as stored, and deleted from the default store', async () => {
    await deleteLedger();
    await seed();
    const before = await stored();

    expect(await settleLedgerPlace()).toEqual({ moved: true, deleted: 0 });
    expect(await Dexie.getDatabaseNames()).toEqual([]);
    expect(await ledgerBuckets()).toEqual([FIRST_LEDGER_BUCKET]);
    expect(await stored(FIRST_LEDGER_BUCKET)).toEqual(before);
  });

  it('goes with every ledger bucket on Delete all data', async () => {
    await seed();
    await nameLedgerBucket(await copyLedger(FIRST_LEDGER_BUCKET));

    await deleteLedger();
    expect(await ledgerBuckets()).toEqual([]);
    expect(await Dexie.getDatabaseNames()).toEqual([]);
  });
});
