/**
 * The person's settings in the service worker at their edges (sprint_4 4.5; src/background/settings.ts; Sprint 4 QA
 * review): a retention window that cannot be stored is answered failed, logged, and announces nothing; Delete all data
 * asked twice leaves the ledger empty both times; and readers that cannot be brought back on after a wipe are logged
 * loud while the wipe still stands. Every value is invented.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { onLedgerWipe, onRetentionSave } from '../../../src/background/settings';
import type { LedgerTable } from '../../../src/bus/messages';
import { STORAGE_KEYS } from '../../../src/config';
import { closeLedger, getLedger, upsertClaim } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';
import { makeClaim, pinClock, releaseClock } from '../ledger/fixtures';

let notify: ReturnType<typeof vi.fn<(tables: readonly LedgerTable[]) => void>>;
let records: LogRecord[];
let restore: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  pinClock('2026-10-01T10:30:00-04:00');
  notify = vi.fn<(tables: readonly LedgerTable[]) => void>();
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(async () => {
  restore();
  releaseClock();
  await closeLedger();
});

describe('retention.save that cannot be stored', () => {
  it('is answered failed, logged without a value, and announces nothing', async () => {
    const ctx = { db: () => Promise.reject(new Error('the ledger did not open')), notify };
    expect(await onRetentionSave(ctx, { type: 'retention.save', days: 30 })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(records.map(({ event }) => event)).toEqual(['retention.save_failed']);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('ledger.wipe, twice', () => {
  it('leaves the ledger and chrome.storage.local empty each time, the second over nothing', async () => {
    await upsertClaim(await getLedger(), makeClaim());
    await browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: { ATTEST_AUTO_CHECK_GMAIL: true } });
    const syncReaders = vi.fn(() => Promise.resolve());
    expect(await onLedgerWipe({ notify, syncReaders })).toEqual({ ok: true });
    expect(await onLedgerWipe({ notify, syncReaders })).toEqual({ ok: true });
    expect(await (await getLedger()).claims.count()).toBe(0);
    expect(await browser.storage.local.get(null)).toEqual({});
    expect(notify).toHaveBeenCalledTimes(2);
    expect(syncReaders).toHaveBeenCalledTimes(2);
  });

  it('still stands when the readers cannot be brought back on: logged loud, answered done', async () => {
    await upsertClaim(await getLedger(), makeClaim());
    const syncReaders = () => Promise.reject(new Error('scripting unavailable'));
    expect(await onLedgerWipe({ notify, syncReaders })).toEqual({ ok: true });
    expect(await (await getLedger()).claims.count()).toBe(0);
    expect(records.filter(({ level }) => level === 'error').map(({ event }) => event)).toEqual([
      'readers.sync_failed',
    ]);
  });
});
