import 'fake-indexeddb/auto';
/**
 * A damaged record of the ledger's key (Sprint 6 close, security review SEC-6 and tech review TECH-7; Hard Rule 6), on
 * the shared ledger in fake-indexeddb and WXT's fake browser, with the real 600,000 PBKDF2 rounds: a record that
 * cannot be read is answered `damaged` and logged at error by its field, never its value, and never as a wrong
 * passphrase the person would type again and again. Rounds of 599,999 and 6,000,001 (the bounds MIN_KDF_ITERATIONS
 * and MAX_KDF_ITERATIONS keep), a salt that is not base64 or not 16 bytes, a key id gone, a key check that does not
 * read as one, and, mid-change, a key before that the right key does not open: the ledger stays locked, whole. A wrong
 * passphrase is still just that.
 */
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
import { letSleep } from '../../../src/background/keep-awake';
import type { LedgerTable } from '../../../src/bus/messages';
import { MAX_KDF_ITERATIONS, MIN_KDF_ITERATIONS } from '../../../src/config-crypto';
import { clearKeyring, isLocked } from '../../../src/crypto/keyring';
import { CRYPTO_KEYS } from '../../../src/ledger/crypto-state';
import { getLedger, setMeta } from '../../../src/ledger/repo';
import { deleteLedger } from '../../../src/ledger/shared';
import { type LogRecord, setLogSink } from '../../../src/log';

/** Invented only. */
const FIRST = 'an invented passphrase';
const SECOND = 'another invented passphrase';

const notify = vi.fn<(tables: readonly LedgerTable[]) => void>();
const deps: CryptoDeps = { db: getLedger, notify };
let records: LogRecord[];
let restoreSink: () => void;

const unlock = (passphrase: string = FIRST) => onCryptoUnlock({ type: 'crypto.unlock', passphrase }, deps);
const invalid = () =>
  records.filter((record) => record.event === 'crypto.key_record_invalid').map((record) => record.fields);

beforeEach(async () => {
  fakeBrowser.reset();
  holdKeysHere();
  expect(await onCryptoEnable({ type: 'crypto.enable', passphrase: FIRST }, deps)).toEqual({ ok: true });
  await resumeCryptoJob(deps);
  expect(await onCryptoLock(deps)).toEqual({ ok: true });
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(async () => {
  restoreSink();
  letSleep();
  await deleteLedger();
  clearKeyring();
});

/** Each way the key record can be damaged, and the field the error names. */
const DAMAGE: readonly [string, () => Promise<unknown>, string][] = [
  [
    'rounds below the floor',
    async () => setMeta(await getLedger(), CRYPTO_KEYS.ITERATIONS, MIN_KDF_ITERATIONS - 1),
    'iterations',
  ],
  [
    'rounds above the bound',
    async () => setMeta(await getLedger(), CRYPTO_KEYS.ITERATIONS, MAX_KDF_ITERATIONS + 1),
    'iterations',
  ],
  [
    'a salt that is not base64',
    async () => setMeta(await getLedger(), CRYPTO_KEYS.SALT, 'not base64!'),
    'salt',
  ],
  ['a salt of 8 bytes', async () => setMeta(await getLedger(), CRYPTO_KEYS.SALT, 'AAAAAAAAAAA='), 'salt'],
  ['a key id gone', async () => (await getLedger()).meta.delete(CRYPTO_KEYS.KEY_ID), 'key_id'],
  [
    'a key check that does not read as one',
    async () => setMeta(await getLedger(), CRYPTO_KEYS.CHECK, 'x'),
    'check',
  ],
];

describe('a damaged key record', () => {
  it.each(DAMAGE)(
    'with %s, refuses the unlock as damaged, logged by its field',
    async (_name, damage, field) => {
      await damage();
      expect(await unlock()).toEqual({ ok: false, code: 'damaged' });
      expect(isLocked()).toBe(true);
      expect(invalid()).toEqual([{ field }]);
      expect(records.filter((record) => record.event === 'crypto.unlock_refused')).toEqual([]);
    },
  );

  it('refuses a change and a turn-off as damaged too', async () => {
    await setMeta(await getLedger(), CRYPTO_KEYS.SALT, 'not base64!');
    expect(await onCryptoChange({ type: 'crypto.change', passphrase: FIRST, next: SECOND }, deps)).toEqual({
      ok: false,
      code: 'damaged',
    });
    expect(await onCryptoDisable({ type: 'crypto.disable', passphrase: FIRST }, deps)).toEqual({
      ok: false,
      code: 'damaged',
    });
    expect(invalid()).toEqual([{ field: 'salt' }, { field: 'salt' }]);
  });

  it('refuses an unlock whose key before, mid-change, the right key does not open: never half the ledger', async () => {
    await setMeta(
      await getLedger(),
      CRYPTO_KEYS.PREVIOUS,
      'bbbbbbbbbbbb.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
    expect(await unlock()).toEqual({ ok: false, code: 'damaged' });
    expect(isLocked()).toBe(true);
    expect(invalid()).toEqual([{ field: 'previous' }]);
  });

  it('still answers a wrong passphrase as wrong, logged at info, with nothing called damaged', async () => {
    expect(await unlock('not the passphrase at all')).toEqual({ ok: false, code: 'wrong_passphrase' });
    expect(records.map((record) => record.event)).toContain('crypto.unlock_refused');
    expect(invalid()).toEqual([]);
    expect(await unlock()).toEqual({ ok: true });
  });
});
