/**
 * The person's settings in the service worker (sprint_4 4.5; src/background/settings.ts): the retention window is
 * stored and announced; Delete all data leaves every ledger table and `chrome.storage.local` empty (the "wipe verified
 * empty" of the done-when), announces every table, brings the readers back on, and a page's own connection to the
 * ledger, closed by the delete, reads the new, empty ledger. Every value is invented.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { onLedgerWipe, onRetentionSave } from '../../../src/background/settings';
import { LedgerTable } from '../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { SESSION_KEYS, STORAGE_KEYS } from '../../../src/config';
import { readersOff, readFlags, saveFlag, saveReaderOff } from '../../../src/ledger/consent';
import { LEDGER_TABLE_NAMES } from '../../../src/ledger/index-fields';
import { openLedger } from '../../../src/ledger/migrations';
import {
  closeLedger,
  getLedger,
  putGrant,
  putReceipt,
  setMeta,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import { readRetentionDays } from '../../../src/ledger/settings';
import { setLogSink } from '../../../src/log';
import {
  makeClaim,
  makeGrant,
  makeObservation,
  makeReceipt,
  pinClock,
  releaseClock,
} from '../ledger/fixtures';

let notify: ReturnType<typeof vi.fn<(tables: readonly LedgerTable[]) => void>>;
let restore: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  pinClock('2026-10-01T10:30:00-04:00');
  notify = vi.fn<(tables: readonly LedgerTable[]) => void>();
  restore = setLogSink(() => undefined);
});

afterEach(async () => {
  restore();
  releaseClock();
  await closeLedger();
});

/** Every table that is not empty, by name. */
async function filled(): Promise<string[]> {
  const db = await getLedger();
  const counts = await Promise.all(
    db.tables.map(async (table) => [table.name, await table.count()] as const),
  );
  return counts.filter(([, count]) => count > 0).map(([name]) => name);
}

describe('retention.save', () => {
  it('stores the window and announces meta', async () => {
    const ctx = { db: getLedger, notify };
    expect(await onRetentionSave(ctx, { type: 'retention.save', days: 180 })).toEqual({ ok: true });
    expect(await readRetentionDays(await getLedger())).toBe(180);
    expect(notify.mock.calls).toEqual([[['meta']]]);
  });
});

describe('ledger.wipe', () => {
  it('leaves every table and both storage areas empty but for the readers kept off, clears the notifications, and announces it', async () => {
    const db = await getLedger();
    await upsertObservation(db, makeObservation(), DEFAULT_POLICY);
    await upsertClaim(db, makeClaim());
    await putReceipt(db, makeReceipt());
    await putGrant(db, makeGrant());
    await setMeta(db, 'retentionDays', 30);
    await saveReaderOff(db, 'gcal', true);
    await saveFlag(db, 'ATTEST_AUTO_CHECK_GMAIL', true);
    await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_ID]: '0b6f3a52-6f1e-4c43-9d6a-2f0e8f1c7a11' });
    await browser.storage.session.set({ [SESSION_KEYS.OPEN_RECEIPT]: makeReceipt().id });
    // A page's own connection, open while the service worker deletes the database.
    const page = await openLedger();
    expect(await page.claims.count()).toBe(1);
    expect((await filled()).length).toBeGreaterThan(4);
    const syncReaders = vi.fn(() => Promise.resolve());
    const clearNotifications = vi.fn(() => Promise.resolve());

    expect(await onLedgerWipe({ notify, syncReaders, clearNotifications })).toEqual({ ok: true });

    // Only the choice to read less is kept: the reader the person turned off (security review SEC-6).
    expect(await filled()).toEqual(['meta']);
    expect(await (await getLedger()).meta.toArray()).toEqual([{ key: 'readerOff.gcal', value: true }]);
    expect(await readersOff(await getLedger())).toEqual(new Set(['gcal']));
    expect((await readFlags(await getLedger())).ATTEST_AUTO_CHECK_GMAIL).toBe(false);
    expect(await browser.storage.local.get(null)).toEqual({});
    expect(await browser.storage.session.get(null)).toEqual({});
    expect(clearNotifications).toHaveBeenCalledOnce();
    expect(notify.mock.calls).toEqual([[LedgerTable.options]]);
    expect(syncReaders).toHaveBeenCalledOnce();
    // The page's connection was closed by the delete; it reads the new, empty ledger at its next read.
    expect(await page.claims.count()).toBe(0);
    expect((await getLedger()).tables.map(({ name }) => name).sort()).toEqual(
      [...LEDGER_TABLE_NAMES, 'receiptInputs', 'policies', 'batchCoverages'].sort(),
    );
    page.close();
  });

  it('answers failed, logged, when storage cannot be cleared', async () => {
    const records: string[] = [];
    restore();
    restore = setLogSink((record) => {
      records.push(record.event);
    });
    const result = await onLedgerWipe({
      notify,
      syncReaders: () => Promise.resolve(),
      clearStorage: () => Promise.reject(new Error('quota')),
    });
    expect(result).toEqual({ ok: false, code: 'failed' });
    expect(records).toContain('ledger.wipe_failed');
    expect(notify).not.toHaveBeenCalled();
  });
});
