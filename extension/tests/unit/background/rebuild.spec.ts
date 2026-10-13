import 'fake-indexeddb/auto';
/**
 * Rebuilding the ledger's database in the service worker (src/background/rebuild.ts; Sprint 6 close, security review
 * SEC-1), on fake-indexeddb and WXT's fake browser, each case a fresh start of the worker's modules:
 *  - every read of the ledger here waits until every row is back, and the pages are told by the session's mark, set
 *    for the rebuild and removed after it; a page waits to read while it is set, and closes its connection;
 *  - a copy that fails leaves the ledger as it was, releases every read, and the rebuild stays due;
 *  - a restore that fails keeps every read waiting, so nothing reads a ledger that is not whole;
 *  - at a start, a whole copy a stop left is put back before anything reads, and a rebuild due runs, unless a job is
 *    under way.
 */
import { Dexie } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { LedgerTable } from '../../../src/bus/messages';
import { DB_NAME } from '../../../src/config';
import { FLUSH_DB_NAME, REBUILD_DB_NAME } from '../../../src/config-crypto';
import type * as RebuildModule from '../../../src/ledger/rebuild';
import type { LogRecord } from '../../../src/log';

const REBUILD = '../../../src/ledger/rebuild';
const ROWS = 3;
const notify = vi.fn<(tables: readonly LedgerTable[]) => void>();

/** The worker's modules, fresh, as at a new start of it: no hold, no rebuild running, nothing open. */
async function start() {
  vi.resetModules();
  const [rebuild, shared, mark, state, ledger, migrations, log] = await Promise.all([
    import('../../../src/background/rebuild'),
    import('../../../src/ledger/shared'),
    import('../../../src/ledger/rebuild-mark'),
    import('../../../src/ledger/crypto-state'),
    import('../../../src/ledger/rebuild'),
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
    migrations,
    records,
    deps: { db: shared.getLedger, notify },
  };
}

type Started = Awaited<ReturnType<typeof start>>;

/** Three requests, and `meta` as given. */
async function seed(
  { migrations }: Started,
  meta: Readonly<Record<string, string | boolean>> = {},
): Promise<void> {
  const db = await migrations.openLedger(DB_NAME, migrations.MIGRATIONS, { asStored: true });
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
  await Promise.all([DB_NAME, REBUILD_DB_NAME, FLUSH_DB_NAME].map((name) => Dexie.delete(name)));
});

afterEach(() => {
  vi.doUnmock(REBUILD);
});

describe('a rebuild in the service worker, while it runs', () => {
  it('holds every read here until every row is back, and marks it for the pages meanwhile', async () => {
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
});

describe('a rebuild that fails', () => {
  it('leaves the ledger as it was when the copy fails, releases every read, and keeps the rebuild due', async () => {
    vi.doMock(REBUILD, async (importOriginal) => ({
      ...(await importOriginal<typeof RebuildModule>()),
      copyLedger: () => Promise.reject(new Error('the copy failed')),
    }));
    const worker = await start();
    worker.shared.ignoreRebuildMark();
    await seed(worker, { 'crypto.rebuild': true });

    await worker.rebuild.rebuildLedger(worker.deps);
    const db = await worker.shared.getLedger();
    expect(await db.requests.count()).toBe(ROWS);
    expect((await worker.state.readCryptoState(db)).rebuild).toBe(true);
    expect(await worker.mark.readRebuildMark()).toBe(false);
    expect(failed(worker.records)).toEqual(['copy']);
  });

  it('keeps every read waiting when putting the rows back fails, so nothing reads a ledger not whole', async () => {
    vi.doMock(REBUILD, async (importOriginal) => ({
      ...(await importOriginal<typeof RebuildModule>()),
      restoreLedger: () => Promise.reject(new Error('the restore failed')),
    }));
    const worker = await start();
    worker.shared.ignoreRebuildMark();
    await seed(worker, { 'crypto.rebuild': true });

    await worker.rebuild.rebuildLedger(worker.deps);
    expect(await settles(worker.shared.getLedger())).toBe(false);
    expect(await worker.mark.readRebuildMark()).toBe(true);
    expect(failed(worker.records)).toEqual(['restore']);
  });
});

describe("the worker's start", () => {
  it('puts every row back from a whole copy a stop left, before anything reads the ledger', async () => {
    const before = await start();
    await seed(before, { 'crypto.rebuild': true });
    await before.ledger.copyLedger();
    await Dexie.delete(DB_NAME);

    const worker = await start();
    const resumed = worker.rebuild.resumeRebuild(worker.deps);
    const db = await worker.shared.getLedger();
    expect(await db.requests.count()).toBe(ROWS);
    await resumed;
    expect(await Dexie.getDatabaseNames()).toEqual([DB_NAME]);
    expect(worker.records.map((record) => record.event)).toContain('ledger.rebuild_resumed');
  });

  it('runs a rebuild due with no job under way, and leaves one due while a job is', async () => {
    const idle = await start();
    await seed(idle, { 'crypto.rebuild': true });
    await idle.rebuild.resumeRebuild(idle.deps);
    expect((await idle.state.readCryptoState(await idle.shared.getLedger())).rebuild).toBeUndefined();
    expect(idle.records.map((record) => record.event)).toContain('ledger.rebuilt');
    await idle.shared.closeLedger();

    await Dexie.delete(DB_NAME);
    const busy = await start();
    await seed(busy, { 'crypto.rebuild': true, 'crypto.job': 'seal' });
    await busy.rebuild.resumeRebuild(busy.deps);
    expect((await busy.state.readCryptoState(await busy.shared.getLedger())).rebuild).toBe(true);
    expect(busy.records.map((record) => record.event)).not.toContain('ledger.rebuilt');
  });
});
