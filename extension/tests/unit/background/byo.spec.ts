import 'fake-indexeddb/auto';
/**
 * The person's own model key in the service worker (src/background/byo.ts; sprint_5 5.3): `byo.save` closes
 * `chrome.storage.local` to content scripts before it keeps the key and its vendor there, apart, and logs the vendor
 * alone; what is stored reads back only through the bus's schemas; `byo.forget` deletes both and turns the person's
 * own key off in the ledger; a failure is said and logged, never with the key; an install closes the area too. Every
 * value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { onByoForget, onByoSave, readByo } from '../../../src/background/byo';
import { onInstalled } from '../../../src/background/install';
import { STORAGE_KEYS } from '../../../src/config';
import { readFlags, saveFlag } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { type LogRecord, setLogSink } from '../../../src/log';
import { accessLevels } from '../fake-browser-setup';
import { uniqueDbName } from '../ledger/fixtures';

const KEY = 'sk-ant-invented-test-key-0123456789';
let db: LedgerDb;
let records: LogRecord[];
let restore: () => void;
let notified: string[][];

beforeEach(async () => {
  fakeBrowser.reset();
  db = await openLedger(uniqueDbName('byo'));
  records = [];
  restore = setLogSink((record) => records.push(record));
  notified = [];
});
afterEach(() => {
  db.close();
  restore();
});

const ctx = () => ({
  db: () => Promise.resolve(db),
  notify: (tables: readonly string[]) => notified.push([...tables]),
});
const stored = () => fakeBrowser.storage.local.get(null);

describe('byo.save', () => {
  it('closes the area to content scripts, keeps the key and its vendor apart, and logs the vendor alone', async () => {
    // An OpenAI key under OpenAI: a key must be its vendor's (Sprint 5 close, SEC-7; ./byo-vendor-fit.spec.ts).
    const openaiKey = 'sk-proj-invented-test-key-0123456789';
    expect(await onByoSave({ type: 'byo.save', vendor: 'openai', key: openaiKey }, ctx())).toEqual({
      ok: true,
    });
    expect(accessLevels.get('local')).toBe('TRUSTED_CONTEXTS');
    expect(await stored()).toEqual({
      [STORAGE_KEYS.BYO_KEY]: openaiKey,
      [STORAGE_KEYS.BYO_VENDOR]: 'openai',
    });
    expect(await readByo()).toEqual({ vendor: 'openai', key: openaiKey });
    expect(notified).toEqual([['meta']]);
    expect(records.map(({ event, fields }) => [event, fields.vendor])).toEqual([['byo.saved', 'openai']]);
    expect(JSON.stringify(records)).not.toContain(openaiKey);
  });

  it('says a failure, and logs it without the key', async () => {
    const failing = {
      get: fakeBrowser.storage.local.get.bind(fakeBrowser.storage.local),
      remove: fakeBrowser.storage.local.remove.bind(fakeBrowser.storage.local),
      setAccessLevel: () => Promise.resolve(),
      set: () => Promise.reject(new Error(`quota: ${KEY}`)),
    };
    const result = await onByoSave(
      { type: 'byo.save', vendor: 'anthropic', key: KEY },
      { ...ctx(), storage: failing },
    );
    expect(result).toEqual({ ok: false, code: 'failed' });
    expect(records.map(({ event }) => event)).toEqual(['byo.save_failed']);
    expect(JSON.stringify(records)).not.toContain(KEY);
    expect(notified).toEqual([]);
  });
});

describe('what is stored', () => {
  it('reads as none when nothing is, and as none, logged without the value, when it is not a key and vendor', async () => {
    expect(await readByo()).toBeNull();
    await fakeBrowser.storage.local.set({
      [STORAGE_KEYS.BYO_KEY]: 'not a key',
      [STORAGE_KEYS.BYO_VENDOR]: 'anthropic',
    });
    expect(await readByo()).toBeNull();
    await fakeBrowser.storage.local.set({
      [STORAGE_KEYS.BYO_KEY]: KEY,
      [STORAGE_KEYS.BYO_VENDOR]: 'mistral',
    });
    expect(await readByo()).toBeNull();
    expect(records.map(({ event }) => event)).toEqual(['byo.stored_invalid', 'byo.stored_invalid']);
    expect(JSON.stringify(records)).not.toContain('not a key');
  });
});

describe('byo.forget', () => {
  it('deletes the key and its vendor, and turns the person’s own key off', async () => {
    await onByoSave({ type: 'byo.save', vendor: 'anthropic', key: KEY }, ctx());
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    expect(await onByoForget(ctx())).toEqual({ ok: true });
    expect(await stored()).toEqual({});
    expect((await readFlags(db)).ATTEST_MODEL_BYO).toBe(false);
    expect(notified).toEqual([['meta'], ['meta']]);
  });
});

describe('an install', () => {
  it('closes chrome.storage.local to content scripts', async () => {
    await onInstalled({ reason: 'install' });
    expect(accessLevels.get('local')).toBe('TRUSTED_CONTEXTS');
  });
});
