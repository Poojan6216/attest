import 'fake-indexeddb/auto';
/**
 * The person's own model key at its edges (Sprint 5 QA review; src/background/byo.ts, settings.ts; sprint_5 5.3;
 * Hard Rules 2, 10). byo.spec.ts checks that the area is closed once a key is saved, but not that it is closed first:
 *  - `byo.save` closes `chrome.storage.local` to content scripts before it writes the key, and when Chrome does not
 *    close it, the key is not written at all (a key in an area a Gmail page's script can read is a leaked key);
 *  - a second key replaces the first, vendor and key together;
 *  - `byo.forget` that cannot delete says so, logged without the key; with no key saved it still turns the key off;
 *  - Delete all data takes Sprint 5's data with everything else: the key and its vendor, the model's answers, the
 *    telemetry's sent day, and the switches of the model, the key and the usage numbers, all back to off.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { type ByoStorage, onByoForget, onByoSave, readByo } from '../../../src/background/byo';
import { onLedgerWipe } from '../../../src/background/settings';
import { STORAGE_KEYS } from '../../../src/config';
import { readFlags, saveFlag } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { claimAsk } from '../../../src/ledger/model-answers';
import { closeLedger, getLedger } from '../../../src/ledger/repo';
import { recordTelemetrySent, telemetrySentDay } from '../../../src/ledger/telemetry-sent';
import { ModelAnswer } from '../../../src/ledger/types';
import { type LogRecord, setLogSink } from '../../../src/log';
import { accessLevels } from '../fake-browser-setup';
import { sha, ulid, uniqueDbName } from '../ledger/fixtures';

const KEY = 'sk-ant-qa-invented-edges-0123456789';
const OTHER_KEY = 'sk-proj-qa-invented-edges-9876543210';
let db: LedgerDb;
let records: LogRecord[];
let restore: () => void;
let notified: string[][];

beforeEach(async () => {
  fakeBrowser.reset();
  db = await openLedger(uniqueDbName('byo-edges'));
  records = [];
  restore = setLogSink((record) => records.push(record));
  notified = [];
});
afterEach(async () => {
  db.close();
  restore();
  await closeLedger();
});

const ctx = (storage?: ByoStorage) => ({
  db: () => Promise.resolve(db),
  notify: (tables: readonly string[]) => notified.push([...tables]),
  ...(storage === undefined ? {} : { storage }),
});
const stored = () => fakeBrowser.storage.local.get(null);
const local = fakeBrowser.storage.local;

/** `chrome.storage.local` that records the order of what it was asked, closing with `close`. */
function recording(close: () => Promise<void>) {
  const calls: string[] = [];
  const storage: ByoStorage = {
    get: local.get.bind(local),
    remove: local.remove.bind(local),
    setAccessLevel: () => {
      calls.push('close');
      return close();
    },
    set: (items) => {
      calls.push('set');
      return local.set(items);
    },
  };
  return { storage, calls };
}

describe('byo.save closes the area first', () => {
  it('closes chrome.storage.local to content scripts before it writes the key', async () => {
    const { storage, calls } = recording(() => Promise.resolve());
    expect(await onByoSave({ type: 'byo.save', vendor: 'anthropic', key: KEY }, ctx(storage))).toEqual({
      ok: true,
    });
    expect(calls).toEqual(['close', 'set']);
  });

  it('writes nothing when Chrome does not close the area, and says so without the key', async () => {
    const { storage, calls } = recording(() => Promise.reject(new Error(`no access level for ${KEY}`)));
    expect(await onByoSave({ type: 'byo.save', vendor: 'anthropic', key: KEY }, ctx(storage))).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(calls).toEqual(['close']);
    expect(await stored()).toEqual({});
    expect(records.map(({ event }) => event)).toEqual(['byo.save_failed']);
    expect(JSON.stringify(records)).not.toContain(KEY);
    expect(notified).toEqual([]);
  });

  it('a second key replaces the first, its vendor with it', async () => {
    await onByoSave({ type: 'byo.save', vendor: 'anthropic', key: KEY }, ctx());
    await onByoSave({ type: 'byo.save', vendor: 'openai', key: OTHER_KEY }, ctx());
    expect(await stored()).toEqual({
      [STORAGE_KEYS.BYO_KEY]: OTHER_KEY,
      [STORAGE_KEYS.BYO_VENDOR]: 'openai',
    });
    expect(await readByo()).toEqual({ vendor: 'openai', key: OTHER_KEY });
    expect(accessLevels.get('local')).toBe('TRUSTED_CONTEXTS');
    expect(JSON.stringify(records)).not.toContain(KEY);
    expect(JSON.stringify(records)).not.toContain(OTHER_KEY);
  });
});

describe('byo.forget at its edges', () => {
  it('says so when the key cannot be deleted, logged without the key, and announces nothing', async () => {
    await onByoSave({ type: 'byo.save', vendor: 'anthropic', key: KEY }, ctx());
    notified = [];
    const failing: ByoStorage = {
      get: local.get.bind(local),
      set: local.set.bind(local),
      setAccessLevel: () => Promise.resolve(),
      remove: () => Promise.reject(new Error(`cannot remove ${KEY}`)),
    };
    expect(await onByoForget(ctx(failing))).toEqual({ ok: false, code: 'failed' });
    expect(records.map(({ event }) => event)).toContain('byo.forget_failed');
    expect(JSON.stringify(records)).not.toContain(KEY);
    expect(notified).toEqual([]);
  });

  it('with no key saved, still answers done and leaves the person’s own key off', async () => {
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    expect(await onByoForget(ctx())).toEqual({ ok: true });
    expect(await stored()).toEqual({});
    expect((await readFlags(db)).ATTEST_MODEL_BYO).toBe(false);
  });
});

describe('Delete all data takes Sprint 5’s data too', () => {
  it('the key, the model’s answers, the sent day, and every Sprint 5 switch back to off', async () => {
    const ledger = await getLedger();
    await onByoSave(
      { type: 'byo.save', vendor: 'anthropic', key: KEY },
      { db: () => Promise.resolve(ledger), notify: () => undefined },
    );
    for (const flag of ['ATTEST_MODEL', 'ATTEST_MODEL_BYO', 'ATTEST_TELEMETRY'] as const) {
      await saveFlag(ledger, flag, true);
    }
    await claimAsk(
      ledger,
      ModelAnswer.parse({
        claimId: ulid(1),
        inputsHash: sha(70),
        provider: 'byo',
        askedAt: '2026-10-06T14:21:00-04:00',
      }),
    );
    await recordTelemetrySent(ledger, '2026-10-09');
    const result = await onLedgerWipe({
      notify: vi.fn(),
      syncReaders: () => Promise.resolve(),
      clearNotifications: () => Promise.resolve(),
    });
    expect(result).toEqual({ ok: true });
    const after = await getLedger();
    expect(await browser.storage.local.get(null)).toEqual({});
    expect(await readByo()).toBeNull();
    expect(await after.modelAnswers.count()).toBe(0);
    expect(await telemetrySentDay(after)).toBeNull();
    expect(await readFlags(after)).toMatchObject({
      ATTEST_MODEL: false,
      ATTEST_MODEL_BYO: false,
      ATTEST_TELEMETRY: false,
    });
    expect(JSON.stringify(records)).not.toContain(KEY);
  });
});
