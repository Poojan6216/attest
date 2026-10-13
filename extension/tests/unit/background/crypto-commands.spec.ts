import 'fake-indexeddb/auto';
/**
 * Encryption at rest in the service worker (src/background/crypto.ts; sprint_6 6.5 Done when: "round-trip tests; wrong
 * passphrase yields no plaintext (test reads IndexedDB directly); service-worker restart requires re-unlock"), on the
 * shared ledger in fake-indexeddb and WXT's fake browser, with the real 600,000 PBKDF2 rounds:
 *  - turned on, every row already stored is sealed by the job, and none of its content is readable in IndexedDB; then
 *    the ledger's database is rebuilt (src/background/rebuild.ts), no copy left;
 *  - locked, every read fails; a wrong passphrase leaves it locked and reads nothing; the right one unlocks it;
 *  - a restart of the worker forgets the keys and the pages' copy: locked until the passphrase is typed again;
 *  - a new passphrase seals every row again under the new key, the old passphrase no longer opens it, and a change a
 *    restart interrupted resumes with the new passphrase alone;
 *  - turned off, every row is plain again and every `crypto.` key is gone;
 *  - a command while a job is under way is `busy`, and the worker is kept running only while unlocked.
 */
import { Dexie } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

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
import { keptAwake, letSleep } from '../../../src/background/keep-awake';
import type { LedgerTable } from '../../../src/bus/messages';
import { DB_NAME } from '../../../src/config';
import { LEDGER_KDF_ITERATIONS } from '../../../src/config-crypto';
import { toBase64 } from '../../../src/crypto/bytes';
import { deriveLedgerKey, newKeyId, newSalt } from '../../../src/crypto/kdf';
import { clearKeyring, isLocked, setKeyring } from '../../../src/crypto/keyring';
import { isSealed, keyCheck, wrapKey } from '../../../src/crypto/seal';
import { readSessionKeys } from '../../../src/crypto/session';
import { stepCryptoJob } from '../../../src/ledger/crypto-job';
import { CRYPTO_PREFIX, readCryptoState } from '../../../src/ledger/crypto-state';
import { beginResealing, beginUnsealing } from '../../../src/ledger/crypto-writes';
import { ledgerBucket, ledgerBuckets, nextLedgerBucket } from '../../../src/ledger/place';
import { closeLedger, getClaim, getLedger, getRequest } from '../../../src/ledger/repo';
import { deleteLedger } from '../../../src/ledger/shared';
import { type LogRecord, setLogSink } from '../../../src/log';
import { expectLedgerError, makeClaim, pinClock, releaseClock } from '../ledger/fixtures';
import { ledgerIndexedDb, rawRows, textsIn } from '../crypto/raw-store';
import { CLAIM, CONTENT, REQUEST, SEALED_STORES, seedLedger } from './crypto-fixtures';

/** Invented passphrases only. */
const FIRST = 'an invented passphrase';
const SECOND = 'another invented passphrase';

const notify = vi.fn<(tables: readonly LedgerTable[]) => void>();
const deps: CryptoDeps = { db: getLedger, notify };

/** Every sealed key id in the content tables, and how many rows are plain. */
async function atRest(): Promise<{ readonly keyIds: ReadonlySet<string>; readonly plain: number }> {
  const keyIds = new Set<string>();
  let plain = 0;
  for (const store of SEALED_STORES) {
    for (const row of await rawRows(DB_NAME, store, await ledgerIndexedDb())) {
      if (isSealed(row.sealed)) keyIds.add(row.sealed.k);
      else plain += 1;
    }
  }
  return { keyIds, plain };
}

/** A new start of the service worker: its memory, the keyring and the shared ledger are fresh. */
async function restartWorker(): Promise<void> {
  clearKeyring();
  await closeLedger();
  holdKeysHere();
  await vi.waitFor(async () => {
    expect(await readSessionKeys()).toEqual({});
  });
  await getLedger();
}

async function enable(passphrase: string = FIRST): Promise<void> {
  expect(await onCryptoEnable({ type: 'crypto.enable', passphrase }, deps)).toEqual({ ok: true });
  await resumeCryptoJob(deps);
}

beforeEach(async () => {
  fakeBrowser.reset();
  pinClock();
  holdKeysHere();
  await seedLedger(await getLedger());
});

afterEach(async () => {
  letSleep();
  await deleteLedger();
  clearKeyring();
  releaseClock();
});

describe('turned on', () => {
  it('seals every row the ledger held, leaving no content readable in IndexedDB, and still reads it whole', async () => {
    expect((await atRest()).plain).toBeGreaterThan(0);
    await enable();
    const rest = await atRest();
    expect(rest.plain).toBe(0);
    expect(rest.keyIds.size).toBe(1);
    for (const store of SEALED_STORES) {
      const texts = textsIn(await rawRows(DB_NAME, store, await ledgerIndexedDb())).join('\n');
      for (const value of CONTENT) expect(texts, `${store}: ${value}`).not.toContain(value);
    }
    expect(await getRequest(await getLedger(), REQUEST.id)).toEqual(REQUEST);
    expect((await readCryptoState(await getLedger())).job).toBeUndefined();
    expect(keptAwake()).toBe(true);
    expect((await readSessionKeys()).current?.id).toBe([...rest.keyIds][0]);
  });

  it('then rebuilds the ledger into the next bucket, sealed rows and all, and leaves no other and no rebuild due', async () => {
    const first = await ledgerBucket();
    await enable();
    const state = await readCryptoState(await getLedger());
    expect([state.on, state.job, state.rebuild]).toEqual([true, undefined, undefined]);
    expect(await ledgerBuckets()).toEqual([nextLedgerBucket(first)]);
    expect(await Dexie.getDatabaseNames()).toEqual([]);
    expect((await atRest()).plain).toBe(0);
    expect(await getRequest(await getLedger(), REQUEST.id)).toEqual(REQUEST);
  });

  it('is refused while on', async () => {
    await enable();
    expect(await onCryptoEnable({ type: 'crypto.enable', passphrase: SECOND }, deps)).toEqual({
      ok: false,
      code: 'already_on',
    });
  });
});

describe('locked and unlocked', () => {
  beforeEach(async () => {
    await enable();
    expect(await onCryptoLock(deps)).toEqual({ ok: true });
  });

  it('locks every context: no keys held or kept for pages, every read fails, the worker may sleep', async () => {
    expect(isLocked()).toBe(true);
    expect(await readSessionKeys()).toEqual({});
    expect(keptAwake()).toBe(false);
    await expectLedgerError(getClaim(await getLedger(), CLAIM.id), 'locked');
  });

  it('stays locked for a wrong passphrase, reading nothing, and unlocks for the right one', async () => {
    const before = await rawRows(DB_NAME, 'claims', await ledgerIndexedDb());
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: SECOND }, deps)).toEqual({
      ok: false,
      code: 'wrong_passphrase',
    });
    expect(isLocked()).toBe(true);
    expect(await readSessionKeys()).toEqual({});
    await expectLedgerError(getClaim(await getLedger(), CLAIM.id), 'locked');
    expect(await rawRows(DB_NAME, 'claims', await ledgerIndexedDb())).toEqual(before);
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toEqual({ ok: true });
    expect(await getClaim(await getLedger(), CLAIM.id)).toMatchObject({ counterparty: CLAIM.counterparty });
  });

  it('needs the passphrase again after a restart of the service worker', async () => {
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toEqual({ ok: true });
    expect(isLocked()).toBe(false);
    await restartWorker();
    expect(isLocked()).toBe(true);
    await expectLedgerError(getClaim(await getLedger(), CLAIM.id), 'locked');
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toEqual({ ok: true });
    expect(await getClaim(await getLedger(), CLAIM.id)).toMatchObject({ rawHash: CLAIM.rawHash });
  });
});

describe('a new passphrase', () => {
  it('seals every row again under the new key; the old passphrase no longer opens the ledger', async () => {
    await enable();
    const first = await atRest();
    expect(
      await onCryptoChange({ type: 'crypto.change', passphrase: SECOND, next: FIRST.repeat(2) }, deps),
    ).toEqual({ ok: false, code: 'wrong_passphrase' });
    expect(await onCryptoChange({ type: 'crypto.change', passphrase: FIRST, next: SECOND }, deps)).toEqual({
      ok: true,
    });
    await resumeCryptoJob(deps);
    const second = await atRest();
    expect(second.plain).toBe(0);
    expect(second.keyIds.size).toBe(1);
    expect([...second.keyIds][0]).not.toBe([...first.keyIds][0]);
    const state = await readCryptoState(await getLedger());
    expect(state.previous).toBeUndefined();
    expect(state.job).toBeUndefined();
    await onCryptoLock(deps);
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toMatchObject({
      ok: false,
    });
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: SECOND }, deps)).toEqual({ ok: true });
    expect(await getClaim(await getLedger(), CLAIM.id)).toMatchObject({ counterparty: CLAIM.counterparty });
  });

  it('resumes after a restart interrupted it, with the new passphrase alone', async () => {
    await enable();
    const db = await getLedger();
    const old = (await readSessionKeys()).current;
    if (old === undefined) throw new Error('no key after enabling');
    const salt = newSalt();
    const next = await deriveLedgerKey(SECOND, salt, newKeyId());
    const record = {
      keyId: next.id,
      salt: toBase64(salt),
      iterations: LEDGER_KDF_ITERATIONS,
      check: keyCheck(next),
    };
    await beginResealing(db, record, wrapKey(next, old));
    setKeyring({ sealing: true, guarded: true, current: next, previous: old });
    await stepCryptoJob(db);
    await stepCryptoJob(db);
    expect((await atRest()).keyIds).toEqual(new Set([old.id, next.id]));
    await restartWorker();
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toMatchObject({
      ok: false,
    });
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: SECOND }, deps)).toEqual({ ok: true });
    await resumeCryptoJob(deps);
    expect(await atRest()).toEqual({ keyIds: new Set([next.id]), plain: 0 });
    expect((await readCryptoState(await getLedger())).previous).toBeUndefined();
  });
});

describe('turned off', () => {
  it('opens every row for good and forgets every key', async () => {
    await enable();
    expect(await onCryptoDisable({ type: 'crypto.disable', passphrase: SECOND }, deps)).toEqual({
      ok: false,
      code: 'wrong_passphrase',
    });
    expect(await onCryptoDisable({ type: 'crypto.disable', passphrase: FIRST }, deps)).toEqual({ ok: true });
    await resumeCryptoJob(deps);
    expect(await atRest()).toEqual({ keyIds: new Set(), plain: expect.any(Number) as number });
    const db = await getLedger();
    expect(await db.meta.where('key').startsWith(CRYPTO_PREFIX).count()).toBe(0);
    expect(await readSessionKeys()).toEqual({});
    expect(isLocked()).toBe(false);
    expect(keptAwake()).toBe(false);
    expect(await getClaim(db, CLAIM.id)).toMatchObject({ counterparty: CLAIM.counterparty });
  });

  it('refuses every command but unlock and lock while a job is under way, and turning off when off', async () => {
    expect(await onCryptoDisable({ type: 'crypto.disable', passphrase: FIRST }, deps)).toEqual({
      ok: false,
      code: 'off',
    });
    await enable();
    await beginUnsealing(await getLedger());
    const busy = { ok: false, code: 'busy' };
    expect(await onCryptoChange({ type: 'crypto.change', passphrase: FIRST, next: SECOND }, deps)).toEqual(
      busy,
    );
    expect(await onCryptoDisable({ type: 'crypto.disable', passphrase: FIRST }, deps)).toEqual(busy);
    expect(await onCryptoEnable({ type: 'crypto.enable', passphrase: SECOND }, deps)).toEqual(busy);
    expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toEqual({ ok: true });
    await resumeCryptoJob(deps);
    expect((await atRest()).keyIds.size).toBe(0);
  });
});

describe('one command at a time', () => {
  it('never derives two keys for one ledger when turned on twice at once', async () => {
    const [one, two] = await Promise.all([
      onCryptoEnable({ type: 'crypto.enable', passphrase: FIRST }, deps),
      onCryptoEnable({ type: 'crypto.enable', passphrase: SECOND }, deps),
    ]);
    // The second waits for the first, then finds encryption on, its job perhaps still under way.
    expect(one).toEqual({ ok: true });
    expect(two).toEqual({ ok: false, code: expect.stringMatching(/^(already_on|busy)$/u) as string });
    await resumeCryptoJob(deps);
    expect((await atRest()).keyIds.size).toBe(1);
    await upsertAnother();
    expect((await atRest()).keyIds.size).toBe(1);
  });
});

/** A claim stored after encryption was turned on: sealed under the same key. */
async function upsertAnother(): Promise<void> {
  const { upsertClaim } = await import('../../../src/ledger/repo');
  await upsertClaim(await getLedger(), makeClaim({ rawHash: 'b'.repeat(64) }));
}

describe('the logs (Hard Rule 10; tech review TECH-13, QA-6)', () => {
  it('hold no passphrase over turning on, a wrong unlock, an unlock, a change and turning off', async () => {
    const records: LogRecord[] = [];
    const restore = setLogSink((record) => {
      records.push(record);
    });
    try {
      await enable();
      expect(await onCryptoLock(deps)).toEqual({ ok: true });
      const wrong = 'a wrong invented passphrase';
      expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: wrong }, deps)).toMatchObject({
        ok: false,
      });
      expect(await onCryptoUnlock({ type: 'crypto.unlock', passphrase: FIRST }, deps)).toEqual({ ok: true });
      expect(await onCryptoChange({ type: 'crypto.change', passphrase: FIRST, next: SECOND }, deps)).toEqual({
        ok: true,
      });
      await resumeCryptoJob(deps);
      expect(await onCryptoDisable({ type: 'crypto.disable', passphrase: SECOND }, deps)).toEqual({
        ok: true,
      });
      await resumeCryptoJob(deps);
      const logged = JSON.stringify(records);
      expect(records.length).toBeGreaterThan(0);
      for (const passphrase of [FIRST, SECOND, wrong]) expect(logged).not.toContain(passphrase);
    } finally {
      restore();
    }
  });
});
