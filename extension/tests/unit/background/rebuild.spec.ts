import 'fake-indexeddb/auto';
/**
 * Rebuilding the ledger in the service worker (src/background/rebuild.ts; Sprint 6 close, security review SEC-1), on
 * fake-indexeddb, the unit run's fake storage buckets and WXT's fake browser, each case a fresh start of the worker's
 * modules:
 *  - every read of the ledger here waits until the rows are in the next bucket and it is named, and the pages are told
 *    by the session's mark, set for the rebuild and removed after it; a page waits to read while it is set, and closes
 *    its connection; a page's connection Chrome closes as it deletes the bucket is forgotten, and the next read opens
 *    the bucket named;
 *  - a copy that fails leaves the ledger where it was, releases every read, and the rebuild stays due; a deletion of the
 *    bucket before that fails is logged, and the next start deletes it;
 *  - at a start, every bucket a stop left is deleted before anything reads, and a rebuild due runs, unless a job is
 *    under way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { LedgerTable } from '../../../src/bus/messages';
import { DB_NAME } from '../../../src/config';
import type { LogRecord } from '../../../src/log';
import { fakeStorageBuckets } from '../storage-buckets-setup';

const ROWS = 3;
const FIRST = 'ledger-1';
const NEXT = 'ledger-2';
const notify = vi.fn<(tables: readonly LedgerTable[]) => void>();

/** The worker's modules, fresh, as at a new start of it: no hold, no rebuild running, nothing open. */
async function start() {
  vi.resetModules();
  const [rebuild, shared, mark, state, ledger, place, migrations, log] = await Promise.all([
    import('../../../src/background/rebuild'),
    import('../../../src/ledger/shared'),
    import('../../../src/ledger/rebuild-mark'),
    import('../../../src/ledger/crypto-state'),
    import('../../../src/ledger/rebuild'),
    import('../../../src/ledger/place'),
    import('../../../src/ledger/migrations'),
    import('../../../src/log'),
  ]);
  const records: LogRecord[] = [];
  log.setLogSink((record) => {
    records.push(record);
  });
  return {
    rebuild,
    shared,
    mark,
    state,
    ledger,
    place,
    migrations,
    records,
    deps: { db: shared.getLedger, notify },
  };
}

type Started = Awaited<ReturnType<typeof start>>;

/** Three requests, and `meta` as given, in the ledger of the bucket named. */
async function seed(
  { migrations, place }: Started,
  meta: Readonly<Record<string, string | boolean>> = {},
): Promise<void> {
  const db = await migrations.openLedger(DB_NAME, migrations.MIGRATIONS, {
    asStored: true,
    indexedDB: await place.bucketIndexedDb(await place.ledgerBucket()),
  });
  await db.requests.bulkAdd(
    Array.from({ length: ROWS }, (_, n) => ({ id: `request-${String(n)}` }) as never),
  );
  await db.meta.bulkPut(Object.entries(meta).map(([key, value]) => ({ key, value })));
  db.close();
}

/** Whether `promise` settles within a few event-loop turns. */
async function settles(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  return settled;
}

const failed = (records: readonly LogRecord[]) =>
  records.filter((record) => record.event === 'ledger.rebuild_failed').map((record) => record.fields.step);

beforeEach(async () => {
  fakeBrowser.reset();
  notify.mockClear();
  for (const bucket of await fakeStorageBuckets.keys()) await fakeStorageBuckets.delete(bucket);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a rebuild in the service worker, while it runs', () => {
  it('holds every read here until the rows are in the next bucket, and marks it for the pages meanwhile', async () => {
    const worker = await start();
    worker.shared.ignoreRebuildMark();
    await seed(worker, { 'crypto.rebuild': true });
    const marks: boolean[] = [];
    worker.mark.onRebuildMarkChanged((on) => marks.push(on));

    const rebuilding = worker.rebuild.rebuildLedger(worker.deps);
    const read = worker.shared.getLedger().then(() => worker.records.map((record) => record.event));
    await rebuilding;

    // The read waited for the rebuild, which logs its end before it lets reads go.
    expect(await read).toContain('ledger.rebuilt');
    expect(worker.records.filter((record) => record.level !== 'info')).toEqual([]);
    expect(marks).toEqual([true, false]);
    expect(notify).toHaveBeenCalledWith(LedgerTable.options);
    expect(await fakeStorageBuckets.keys()).toEqual([NEXT]);
    const db = await worker.shared.getLedger();
    expect(await db.requests.count()).toBe(ROWS);
    expect((await worker.state.readCryptoState(db)).rebuild).toBeUndefined();
  });

  it('keeps a page from reading while the mark is set, its connection closed, and lets it read after', async () => {
    const page = await start();
    await seed(page);
    const before = await page.shared.getLedger();
    await page.mark.setRebuildMark(true);
    await vi.waitFor(() => {
      expect(before.isOpen()).toBe(false);
    });
    const read = page.shared.getLedger();
    expect(await settles(read)).toBe(false);

    await page.mark.setRebuildMark(false);
    expect(await (await read).requests.count()).toBe(ROWS);
  });

  it("forgets a page's connection Chrome closes with its bucket, and opens the bucket named at the next read", async () => {
    const page = await start();
    await seed(page);
    const before = await page.shared.getLedger();
    await page.ledger.copyLedger(FIRST);
    await page.place.nameLedgerBucket(NEXT);
    await page.place.deleteLedgerBucket(FIRST);

    const after = await page.shared.getLedger();
    expect(after).not.toBe(before);
    expect(await after.requests.count()).toBe(ROWS);
    // The connection kept from before never opens again: it would open the deleted bucket, empty.
    await expect(before.requests.count()).rejects.toThrow();
    expect(await fakeStorageBuckets.keys()).toEqual([NEXT]);
  });
});

describe('a rebuild that fails', () => {
  it('leaves the ledger where it was when the copy fails, releases every read, and keeps the rebuild due', async () => {
    const worker = await start();
    worker.shared.ignoreRebuildMark();
    await seed(worker, { 'crypto.rebuild': true });
    const open = fakeStorageBuckets.open.bind(fakeStorageBuckets);
    vi.spyOn(fakeStorageBuckets, 'open').mockImplementation((name) =>
      name === NEXT ? Promise.reject(new Error('no bucket')) : open(name),
    );

    await worker.rebuild.rebuildLedger(worker.deps);
    const db = await worker.shared.getLedger();
    expect(await db.requests.count()).toBe(ROWS);
    expect((await worker.state.readCryptoState(db)).rebuild).toBe(true);
    expect(await worker.place.ledgerBucket()).toBe(FIRST);
    expect(await worker.mark.readRebuildMark()).toBe(false);
    expect(failed(worker.records)).toEqual(['copy']);
  });

  it('logs a bucket before that would not go, reads the new one, and the next start deletes the old', async () => {
    const worker = await start();
    worker.shared.ignoreRebuildMark();
    await seed(worker, { 'crypto.rebuild': true });
    const remove = fakeStorageBuckets.delete.bind(fakeStorageBuckets);
    const refused = vi
      .spyOn(fakeStorageBuckets, 'delete')
      .mockImplementation((name) => (name === FIRST ? Promise.reject(new Error('busy')) : remove(name)));

    await worker.rebuild.rebuildLedger(worker.deps);
    expect(failed(worker.records)).toEqual(['delete']);
    const db = await worker.shared.getLedger();
    expect(await db.requests.count()).toBe(ROWS);
    expect((await worker.state.readCryptoState(db)).rebuild).toBeUndefined();
    expect(await fakeStorageBuckets.keys()).toEqual([FIRST, NEXT]);
    refused.mockRestore();
    await worker.shared.closeLedger();

    const restarted = await start();
    await restarted.rebuild.resumeRebuild(restarted.deps);
    expect(await fakeStorageBuckets.keys()).toEqual([NEXT]);
    expect(restarted.records.map((record) => [record.event, record.fields])).toContainEqual([
      'ledger.place_settled',
      { moved: false, deleted: 1 },
    ]);
  });
});

describe("the worker's start", () => {
  it('deletes a half-made bucket a stop left before anything reads, the ledger where it was', async () => {
    const before = await start();
    await seed(before);
    await before.ledger.copyLedger(FIRST);

    const worker = await start();
    const resumed = worker.rebuild.resumeRebuild(worker.deps);
    const db = await worker.shared.getLedger();
    expect(await fakeStorageBuckets.keys()).toEqual([FIRST]);
    expect(await db.requests.count()).toBe(ROWS);
    await resumed;
  });

  it('runs a rebuild due with no job under way, and leaves one due while a job is', async () => {
    const idle = await start();
    await seed(idle, { 'crypto.rebuild': true });
    await idle.rebuild.resumeRebuild(idle.deps);
    expect((await idle.state.readCryptoState(await idle.shared.getLedger())).rebuild).toBeUndefined();
    expect(idle.records.map((record) => record.event)).toContain('ledger.rebuilt');
    await idle.shared.deleteLedger();

    const busy = await start();
    await seed(busy, { 'crypto.rebuild': true, 'crypto.job': 'seal' });
    await busy.rebuild.resumeRebuild(busy.deps);
    expect((await busy.state.readCryptoState(await busy.shared.getLedger())).rebuild).toBe(true);
    expect(busy.records.map((record) => record.event)).not.toContain('ledger.rebuilt');
  });
});
