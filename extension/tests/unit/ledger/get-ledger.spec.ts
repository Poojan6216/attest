import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DB_NAME } from '../../../src/config';
import { MIGRATIONS } from '../../../src/ledger/migrations';
import { bucketIndexedDb, ledgerBucket } from '../../../src/ledger/place';
import { closeLedger, getLedger, getMeta, setMeta } from '../../../src/ledger/repo';
import { fakeStorageBuckets } from '../storage-buckets-setup';
import { captureLogs, expectLedgerError } from './fixtures';

/** An IndexedDB factory that refuses everything, as a browser with site data blocked would. */
function refusingFactory(): IDBFactory {
  const refuse = (): never => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return {
    open: refuse,
    deleteDatabase: refuse,
    cmp: (a: unknown, b: unknown) => indexedDB.cmp(a, b),
    databases: () => Promise.reject(new DOMException('blocked', 'SecurityError')),
  };
}

afterEach(async () => {
  await closeLedger();
});

describe('getLedger', () => {
  it('opens DB_NAME at the latest migration once and shares the instance', async () => {
    const first = await getLedger();
    const second = await getLedger();
    expect(second).toBe(first);
    expect(first.name).toBe(DB_NAME);
    expect(first.isOpen()).toBe(true);
    expect(first.verno).toBe(MIGRATIONS.at(-1)?.version);
  });

  it('opens it in the storage bucket named (src/ledger/place.ts), never in the default store', async () => {
    const db = await getLedger();
    expect(await (await bucketIndexedDb(await ledgerBucket())).databases()).toEqual([
      { name: DB_NAME, version: db.verno * 10 },
    ]);
    expect(await indexedDB.databases()).toEqual([]);
  });

  it('does not cache a failed open: the next call retries', async () => {
    const logs = captureLogs();
    const refused = vi.spyOn(fakeStorageBuckets, 'open').mockResolvedValue({ indexedDB: refusingFactory() });
    try {
      await expectLedgerError(getLedger(), 'open_failed');
    } finally {
      refused.mockRestore();
      logs.restore();
    }
    expect(logs.records.map((record) => record.event)).toContain('ledger.open_failed');
    const db = await getLedger();
    expect(db.isOpen()).toBe(true);
  });
});

describe('closeLedger', () => {
  it('closes the shared instance; the next getLedger reopens the same data', async () => {
    const first = await getLedger();
    await setMeta(first, 'probe', 7);
    await closeLedger();
    expect(first.isOpen()).toBe(false);
    const reopened = await getLedger();
    expect(reopened).not.toBe(first);
    expect(await getMeta(reopened, 'probe')).toBe(7);
  });

  it('is a safe no-op when nothing is open', async () => {
    await closeLedger();
    await expect(closeLedger()).resolves.toBeUndefined();
  });
});
