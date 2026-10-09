/**
 * The feature flags (sprint_4 4.9; src/background/flags.ts): every flag off until the person turns it on; `flag.set`
 * stores one beside the others, and only an extension page may send it (the bus refuses any flag outside
 * SETTABLE_FLAGS); a stored value that cannot be read is no consent: every flag off, logged; a failed write is said.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { type FlagStorage, onFlagSet, readFlags } from '../../../src/background/flags';
import { createHandlers } from '../../../src/background/router';
import { BusMessage } from '../../../src/bus/messages';
import { FEATURE_FLAG_DEFAULTS, STORAGE_KEYS } from '../../../src/config';
import { closeLedger } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';
import { extensionPage } from '../bus/harness';

let records: LogRecord[];
let restore: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(async () => {
  restore();
  await closeLedger();
});

const AUTO_ON = { type: 'flag.set', flag: 'ATTEST_AUTO_CHECK_GMAIL', on: true } as const;

describe('readFlags', () => {
  it('reads every flag off when nothing is stored', async () => {
    expect(await readFlags(browser.storage.local)).toEqual(FEATURE_FLAG_DEFAULTS);
    expect(Object.values(await readFlags(browser.storage.local)).every((on) => !on)).toBe(true);
  });

  it.each([
    ['a list', ['ATTEST_AUTO_CHECK_GMAIL']],
    ['a flag that is not one of ours', { ATTEST_AUTO_CHECK_GMAIL: true, ATTEST_EVERYTHING: true }],
    ['a value that is not true or false', { ATTEST_AUTO_CHECK_GMAIL: 'yes' }],
    ['text', 'ATTEST_AUTO_CHECK_GMAIL'],
  ])('reads %s as every flag off, and says so', async (_label, stored) => {
    await browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: stored });
    expect(await readFlags(browser.storage.local)).toEqual(FEATURE_FLAG_DEFAULTS);
    expect(records.map(({ event }) => event)).toEqual(['flags.invalid']);
  });
});

describe('flag.set', () => {
  it('turns the auto-check on and off again, keeping every other flag the person set', async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: { ATTEST_DOTS: true } });
    expect(await onFlagSet(AUTO_ON, browser.storage.local)).toEqual({ ok: true });
    expect(await readFlags(browser.storage.local)).toMatchObject({
      ATTEST_DOTS: true,
      ATTEST_AUTO_CHECK_GMAIL: true,
    });
    expect(await onFlagSet({ ...AUTO_ON, on: false }, browser.storage.local)).toEqual({ ok: true });
    expect((await browser.storage.local.get(STORAGE_KEYS.FLAGS))[STORAGE_KEYS.FLAGS]).toEqual({
      ATTEST_DOTS: true,
      ATTEST_AUTO_CHECK_GMAIL: false,
    });
    expect(records.filter(({ event }) => event === 'flags.set').map(({ fields }) => fields)).toEqual([
      { flag: 'ATTEST_AUTO_CHECK_GMAIL', on: true },
      { flag: 'ATTEST_AUTO_CHECK_GMAIL', on: false },
    ]);
  });

  it('replaces a stored record it cannot read', async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: { anything: true } });
    expect(await onFlagSet(AUTO_ON, browser.storage.local)).toEqual({ ok: true });
    expect((await browser.storage.local.get(STORAGE_KEYS.FLAGS))[STORAGE_KEYS.FLAGS]).toEqual({
      ATTEST_AUTO_CHECK_GMAIL: true,
    });
  });

  it('says it failed when the choice cannot be stored, and logs no value', async () => {
    const broken: FlagStorage = {
      get: () => Promise.resolve({}),
      set: () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')),
    };
    expect(await onFlagSet(AUTO_ON, broken)).toEqual({ ok: false, code: 'failed' });
    expect(records.map(({ event }) => event)).toEqual(['flags.set_failed']);
    expect(JSON.stringify(records)).not.toContain('quota');
  });

  it('is answered by the router, and a flag no page may set never parses', async () => {
    const handlers = createHandlers();
    const handler = handlers['flag.set'];
    if (handler === undefined) throw new Error('no flag.set handler');
    expect(await handler(AUTO_ON, extensionPage('/options.html'))).toEqual({ ok: true });
    expect((await readFlags(browser.storage.local)).ATTEST_AUTO_CHECK_GMAIL).toBe(true);
    for (const flag of ['ATTEST_TELEMETRY', 'ATTEST_MODEL', 'ATTEST_DOTS', 'ATTEST_ANYTHING']) {
      expect(BusMessage.safeParse({ ...AUTO_ON, flag }).success).toBe(false);
    }
  });
});
