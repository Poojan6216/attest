import 'fake-indexeddb/auto';
/**
 * Locking fails closed (Sprint 6 close, security review SEC-5 and tech review TECH-6), on the shared ledger in
 * fake-indexeddb and WXT's fake browser, with the real 600,000 PBKDF2 rounds:
 *  - a context whose keyring reload fails drops its keys: it is locked, not left reading with the keys before a lock;
 *  - Lock now clears the pages' copy of the keys even when this worker holds none, as after a start whose clear failed;
 *  - the clear at the worker's start runs before any command, so it never wipes keys a command keeps, and is tried
 *    again once when it fails;
 *  - a job's end takes its turn with the commands: a lock queued while it runs is applied after it, and the worker ends
 *    locked and let sleep, never kept awake while locked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  type CryptoDeps,
  holdKeysHere,
  onCryptoChange,
  onCryptoEnable,
  onCryptoLock,
  resumeCryptoJob,
} from '../../../src/background/crypto';
import { keptAwake, letSleep } from '../../../src/background/keep-awake';
import type { LedgerTable } from '../../../src/bus/messages';
import { SESSION_KEYS } from '../../../src/config';
import { clearKeyring, isLocked, setKeyring } from '../../../src/crypto/keyring';
import { readSessionKeys, writeSessionKeys } from '../../../src/crypto/session';
import { getLedger } from '../../../src/ledger/repo';
import { deleteLedger, reloadKeyring, setKeySource } from '../../../src/ledger/shared';

/** Invented only. */
const FIRST = 'an invented passphrase';
const SECOND = 'another invented passphrase';
const KEY = { id: 'aaaaaaaaaaaa', bytes: Uint8Array.from({ length: 32 }, (_, i) => i + 3) };

const notify = vi.fn<(tables: readonly LedgerTable[]) => void>();

const deps: CryptoDeps = { db: getLedger, notify };
const restorers: (() => void)[] = [];

/**
 * Replaces a method of the session area until the test ends, with its promise form: the fake browser types its
 * callback form beside it, so a spy's implementation could not be typed as it.
 */
function replaceSession(name: 'remove' | 'set', method: (arg: never) => Promise<void>): void {
  const area = fakeBrowser.storage.session;
  const original: unknown = Reflect.get(area, name);
  Reflect.set(area, name, method);
  restorers.push(() => Reflect.set(area, name, original));
}

async function enable(): Promise<void> {
  expect(await onCryptoEnable({ type: 'crypto.enable', passphrase: FIRST }, deps)).toEqual({ ok: true });
  await resumeCryptoJob(deps);
}

beforeEach(() => {
  fakeBrowser.reset();
  holdKeysHere();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const restore of restorers.splice(0)) restore();
  letSleep();
  await deleteLedger();
  clearKeyring();
});

describe('locking fails closed', () => {
  it('drops the keys of a page whose keyring reload fails', async () => {
    await enable();
    // A page: its keys come from the session's copy, read at its open, which then fails to read.
    setKeySource(readSessionKeys);
    await getLedger();
    setKeyring({ sealing: true, guarded: true, current: KEY });
    vi.spyOn(fakeBrowser.storage.session, 'get').mockRejectedValue(new Error('storage failed'));
    await reloadKeyring();
    expect(isLocked()).toBe(true);
  });

  it("clears the pages' copy on Lock now even when this worker holds no key", async () => {
    await enable();
    holdKeysHere();
    await vi.waitFor(async () => {
      expect(await readSessionKeys()).toEqual({});
    });
    // A copy the previous start left, which its clear missed.
    await writeSessionKeys({ current: KEY });
    expect(await onCryptoLock(deps)).toEqual({ ok: true });
    expect(await readSessionKeys()).toEqual({});
  });

  it("tries the start's clear of the pages' copy again when it fails, with no command to do it", async () => {
    await writeSessionKeys({ current: KEY });
    vi.spyOn(fakeBrowser.storage.session, 'remove').mockRejectedValueOnce(new Error('storage failed'));
    holdKeysHere();
    await vi.waitFor(async () => {
      expect(await readSessionKeys()).toEqual({});
    });
  });

  it("runs the start's clear before any command, so it never wipes the keys a command keeps", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const remove = fakeBrowser.storage.session.remove.bind(fakeBrowser.storage.session);
    let first = true;
    replaceSession('remove', (keys: string | string[]) => {
      if (!first) return remove(keys);
      first = false;
      return gate.then(() => remove(keys));
    });
    holdKeysHere();
    const enabling = onCryptoEnable({ type: 'crypto.enable', passphrase: FIRST }, deps);
    // Held until the enable has kept its keys, or long after it would have: the clear must not come after them.
    await Promise.race([enabling, new Promise((resolve) => setTimeout(resolve, 3_000))]);
    release();
    expect(await enabling).toEqual({ ok: true });
    await resumeCryptoJob(deps);
    expect((await readSessionKeys()).current).toBeDefined();
  });
});

describe("a job's end", () => {
  it('applies a lock queued while a job ends after it, and leaves the worker locked and let sleep', async () => {
    await enable();
    // The job's end writes the keys for the pages; hold that write until the lock is queued behind it.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const set = fakeBrowser.storage.session.set.bind(fakeBrowser.storage.session);
    let armed = false;
    let held = false;
    replaceSession('set', (items: Record<string, unknown>) => {
      if (!armed || !(SESSION_KEYS.LEDGER_KEYS in items)) return set(items);
      armed = false;
      held = true;
      return gate.then(() => set(items));
    });
    expect(await onCryptoChange({ type: 'crypto.change', passphrase: FIRST, next: SECOND }, deps)).toEqual({
      ok: true,
    });
    // The job it started runs in IndexedDB's turns, so its end comes after this: the next write of the keys is its.
    armed = true;
    const job = resumeCryptoJob(deps);
    await vi.waitFor(() => {
      expect(held).toBe(true);
    });
    const locked = onCryptoLock(deps);
    release();
    await Promise.all([job, locked]);
    expect(isLocked()).toBe(true);
    expect(keptAwake()).toBe(false);
    expect(await readSessionKeys()).toEqual({});
  });
});
