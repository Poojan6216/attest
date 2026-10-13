import 'fake-indexeddb/auto';
/**
 * The person's own model key while encryption at rest is on (src/background/byo.ts; Sprint 6 close, security review
 * SEC-2), on the shared ledger in fake-indexeddb and WXT's fake browser, with the real 600,000 PBKDF2 rounds: a key
 * saved before encryption is turned on is sealed then, and one saved while it is on is stored sealed, so
 * `chrome.storage.local` never holds it in the clear; the worker still reads it whole; while the ledger is locked it
 * does not open, nothing would go to the model, and a save is refused; a new passphrase seals it again under the new
 * key; turning encryption off opens it for good; a sealed key that does not open reads as none; and no log ever holds
 * it (Hard Rule 10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { onByoSave, readByo } from '../../../src/background/byo';
import {
  type CryptoDeps,
  holdKeysHere,
  onCryptoChange,
  onCryptoDisable,
  onCryptoEnable,
  onCryptoLock,
  onCryptoUnlock,
  resumeCryptoJob,
} from '../../../src/background/crypto';
import { letSleep } from '../../../src/background/keep-awake';
import type { LedgerTable } from '../../../src/bus/messages';
import { STORAGE_KEYS } from '../../../src/config';
import { clearKeyring } from '../../../src/crypto/keyring';
import { sealedTextKeyId } from '../../../src/crypto/seal';
import { readCryptoState } from '../../../src/ledger/crypto-state';
import { getLedger } from '../../../src/ledger/repo';
import { deleteLedger } from '../../../src/ledger/shared';
import { type LogRecord, setLogSink } from '../../../src/log';

/** Invented only. */
const KEY = 'sk-ant-invented-sealed-key-0123456789';
const FIRST = 'an invented passphrase';
const SECOND = 'another invented passphrase';

const notify = vi.fn<(tables: readonly LedgerTable[]) => void>();
const deps: CryptoDeps = { db: getLedger, notify };
let records: LogRecord[];
let restoreSink: () => void;

/** The key as `chrome.storage.local` holds it. */
async function stored(): Promise<unknown> {
  return (await fakeBrowser.storage.local.get(STORAGE_KEYS.BYO_KEY))[STORAGE_KEYS.BYO_KEY];
}

const save = () => onByoSave({ type: 'byo.save', vendor: 'anthropic', key: KEY }, { db: getLedger, notify });

async function enable(): Promise<void> {
  expect(await onCryptoEnable({ type: 'crypto.enable', passphrase: FIRST }, deps)).toEqual({ ok: true });
  await resumeCryptoJob(deps);
}

/** The key the ledger's rows are sealed with now, by its id. */
const currentKeyId = async (): Promise<string | undefined> =>
  (await readCryptoState(await getLedger())).keyId;

beforeEach(() => {
  fakeBrowser.reset();
  holdKeysHere();
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(async () => {
  // Hard Rule 10: no log, of any case, ever holds the key.
  expect(JSON.stringify(records)).not.toContain(KEY);
  restoreSink();
  letSleep();
  await deleteLedger();
  clearKeyring();
});

describe('the model key while encryption is on', () => {
  it('saved before encryption is turned on, is sealed then, and still read whole', async () => {
    expect(await save()).toEqual({ ok: true });
    expect(await stored()).toBe(KEY);
    await enable();
    const sealed = await stored();
    expect(typeof sealed === 'string' && sealedTextKeyId(sealed)).toBe(await currentKeyId());
    expect(String(sealed)).not.toContain('sk-ant');
    expect(await readByo()).toEqual({ vendor: 'anthropic', key: KEY });
  });

  it('saved while encryption is on, is stored sealed, never in the clear', async () => {
    await enable();
    expect(await save()).toEqual({ ok: true });
    expect(sealedTextKeyId(String(await stored()))).toBe(await currentKeyId());
    expect(await readByo()).toEqual({ vendor: 'anthropic', key: KEY });
  });

  it('does not open while locked, so nothing goes to the model, and a save is refused', async () => {
    await enable();
    await save();
    const sealed = await stored();
    expect(await onCryptoLock(deps)).toEqual({ ok: true });
    expect(await readByo()).toBeNull();
    expect(await save()).toEqual({ ok: false, code: 'failed' });
    expect(await stored()).toBe(sealed);
    expect(records.filter((record) => record.event === 'byo.stored_invalid')).toEqual([]);

    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toEqual({ ok: true });
    expect(await readByo()).toEqual({ vendor: 'anthropic', key: KEY });
  });
});

describe('the model key as the keys change', () => {
  it('is sealed again under a new passphrase, and opens with it after a restart', async () => {
    await enable();
    await save();
    const before = sealedTextKeyId(String(await stored()));
    expect(await onCryptoChange({ type: 'crypto.change', passphrase: FIRST, next: SECOND }, deps)).toEqual({
      ok: true,
    });
    await resumeCryptoJob(deps);
    const after = sealedTextKeyId(String(await stored()));
    expect(after).toBe(await currentKeyId());
    expect(after).not.toBe(before);

    clearKeyring();
    holdKeysHere();
    expect(await readByo()).toBeNull();
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: SECOND }, deps)).toEqual({ ok: true });
    expect(await readByo()).toEqual({ vendor: 'anthropic', key: KEY });
  });

  it('is opened for good when encryption is turned off', async () => {
    await enable();
    await save();
    expect(await onCryptoDisable({ type: 'crypto.disable', passphrase: FIRST }, deps)).toEqual({ ok: true });
    await resumeCryptoJob(deps);
    expect(await stored()).toBe(KEY);
    expect(await readByo()).toEqual({ vendor: 'anthropic', key: KEY });
  });

  it('reads as none when its sealed value does not open, logged without its value', async () => {
    await enable();
    await save();
    const sealed = String(await stored());
    // A character inside the ciphertext, away from base64's padding, whose low bits may not count.
    const at = sealed.lastIndexOf('.') + 5;
    const flipped = `${sealed.slice(0, at)}${sealed[at] === 'A' ? 'B' : 'A'}${sealed.slice(at + 1)}`;
    await fakeBrowser.storage.local.set({ [STORAGE_KEYS.BYO_KEY]: flipped });
    expect(await readByo()).toBeNull();
    expect(records.map((record) => record.event)).toContain('byo.stored_invalid');
  });
});
