import 'fake-indexeddb/auto';
/**
 * The pages' copy of the ledger's keys (src/crypto/session.ts) and the keyring each context loads from its key source
 * and the ledger's `meta` (src/ledger/crypto-state.ts, src/ledger/shared.ts; sprint_6 6.5): kept in
 * `chrome.storage.session` only, never in `local`; a malformed entry holds no key; the keyring is unlocked only while
 * the ledger may hold sealed rows and a key is held; it asks its source for keys only then; and a page's keyring
 * follows the session's keys as they change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';

import { SESSION_KEYS } from '../../../src/config';
import { clearKeyring, isLocked, keyring } from '../../../src/crypto/keyring';
import type { LedgerKey } from '../../../src/crypto/kdf';
import {
  clearSessionKeys,
  onSessionKeysChanged,
  readSessionKeys,
  writeSessionKeys,
} from '../../../src/crypto/session';
import {
  CRYPTO_KEYS,
  isGuarded,
  loadKeyring,
  readCryptoState,
  sealsNow,
} from '../../../src/ledger/crypto-state';
import { openLedger } from '../../../src/ledger/migrations';
import { closeLedger, getLedger, setMeta } from '../../../src/ledger/repo';
import { setKeySource } from '../../../src/ledger/shared';
import { uniqueDbName } from '../ledger/fixtures';

const keyOf = (fill: number, id: string): LedgerKey => ({
  id,
  bytes: Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + fill) % 256),
});
const KEY = keyOf(1, '0123456789ab');
const PREVIOUS = keyOf(2, 'ba9876543210');

const plain = (key: LedgerKey | undefined) =>
  key === undefined ? undefined : { id: key.id, bytes: [...key.bytes] };

afterEach(async () => {
  await closeLedger();
  await browser.storage.session.clear();
  await browser.storage.local.clear();
  clearKeyring();
});

describe('the session keys', () => {
  it('round-trip through chrome.storage.session, and never touch chrome.storage.local', async () => {
    await writeSessionKeys({ current: KEY, previous: PREVIOUS });
    const read = await readSessionKeys();
    expect(plain(read.current)).toEqual(plain(KEY));
    expect(plain(read.previous)).toEqual(plain(PREVIOUS));
    expect(Object.keys(await browser.storage.session.get(null))).toEqual([SESSION_KEYS.LEDGER_KEYS]);
    expect(await browser.storage.local.get(null)).toEqual({});
  });

  it('are none when nothing is held, after clearing, or when the entry is malformed', async () => {
    expect(await readSessionKeys()).toEqual({});
    await writeSessionKeys({ current: KEY });
    await clearSessionKeys();
    expect(await readSessionKeys()).toEqual({});
    for (const entry of [
      'key',
      { current: { id: 'not-hex', key: 'AAAA' } },
      { current: { id: KEY.id, key: 'AAAA', extra: true } },
      { other: true },
    ]) {
      await browser.storage.session.set({ [SESSION_KEYS.LEDGER_KEYS]: entry });
      expect(await readSessionKeys(), JSON.stringify(entry)).toEqual({});
    }
  });

  it('drop a key of the wrong length, keeping a good one beside it', async () => {
    await browser.storage.session.set({
      [SESSION_KEYS.LEDGER_KEYS]: {
        current: { id: KEY.id, key: 'AAAA' },
        previous: { id: PREVIOUS.id, key: '' },
      },
    });
    expect(await readSessionKeys()).toEqual({});
    await writeSessionKeys({ current: KEY });
    const stored: unknown = (await browser.storage.session.get(SESSION_KEYS.LEDGER_KEYS))[
      SESSION_KEYS.LEDGER_KEYS
    ];
    await browser.storage.session.set({
      [SESSION_KEYS.LEDGER_KEYS]: { ...(stored as object), previous: { id: PREVIOUS.id, key: 'AAAA' } },
    });
    const read = await readSessionKeys();
    expect(plain(read.current)).toEqual(plain(KEY));
    expect(read.previous).toBeUndefined();
  });

  it('tell a listener when they change, and only then', async () => {
    const heard = vi.fn();
    const stop = onSessionKeysChanged(heard);
    await browser.storage.session.set({ [SESSION_KEYS.OPEN_RECEIPT]: 'x' });
    await browser.storage.local.set({ [SESSION_KEYS.LEDGER_KEYS]: 'x' });
    expect(heard).not.toHaveBeenCalled();
    await writeSessionKeys({ current: KEY });
    await clearSessionKeys();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    await writeSessionKeys({ current: KEY });
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('the keyring a context loads', () => {
  it('is open with encryption off, locked with it on and no key, and unlocked with the key', async () => {
    const db = await openLedger(uniqueDbName('keyring'));
    const asked = vi.fn(() => Promise.resolve({ current: KEY }));
    try {
      await loadKeyring(db, asked);
      expect(keyring()).toEqual({ sealing: false, guarded: false });
      expect(asked).not.toHaveBeenCalled();
      await setMeta(db, CRYPTO_KEYS.SEALING, true);
      await loadKeyring(db, () => Promise.resolve({}));
      expect(isLocked()).toBe(true);
      await loadKeyring(db, asked);
      expect(asked).toHaveBeenCalledTimes(1);
      expect(isLocked()).toBe(false);
      expect(keyring()).toMatchObject({ sealing: true, guarded: true });
      expect(plain(keyring().current)).toEqual(plain(KEY));
    } finally {
      db.close();
    }
  });

  it('stays guarded but stops sealing while encryption is turned off, and reads a malformed state as absent', async () => {
    const db = await openLedger(uniqueDbName('keyring-off'));
    try {
      await setMeta(db, CRYPTO_KEYS.SEALING, true);
      await setMeta(db, CRYPTO_KEYS.JOB, 'unseal');
      const state = await readCryptoState(db);
      expect([isGuarded(state), sealsNow(state)]).toEqual([true, false]);
      await setMeta(db, CRYPTO_KEYS.SEALING, false);
      expect(isGuarded(await readCryptoState(db))).toBe(true);
      await setMeta(db, CRYPTO_KEYS.JOB, 'other');
      await setMeta(db, CRYPTO_KEYS.ITERATIONS, 'many');
      expect(await readCryptoState(db)).toEqual({ on: false });
    } finally {
      db.close();
    }
  });

  it("follows the session's keys in a page's shared ledger: unlocked when a key arrives, locked when it goes", async () => {
    setKeySource(readSessionKeys);
    const db = await getLedger();
    await setMeta(db, CRYPTO_KEYS.SEALING, true);
    await closeLedger();
    await getLedger();
    expect(isLocked()).toBe(true);
    await writeSessionKeys({ current: KEY });
    await vi.waitFor(() => {
      expect(isLocked()).toBe(false);
    });
    await clearSessionKeys();
    await vi.waitFor(() => {
      expect(isLocked()).toBe(true);
    });
    await setMeta(await getLedger(), CRYPTO_KEYS.SEALING, false);
  });
});
