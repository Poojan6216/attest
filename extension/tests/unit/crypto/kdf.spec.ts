/**
 * The ledger's key from a passphrase (src/crypto/kdf.ts; sprint_6 6.5 "PBKDF2 600k+"): PBKDF2-SHA256 at 600,000 rounds
 * by default, checked against Node's own PBKDF2 as an independent implementation; one key per passphrase typed in
 * either Unicode form; a new key for a new salt or passphrase; fresh salts and ids.
 */
import { pbkdf2Sync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LEDGER_KDF_ITERATIONS,
  LEDGER_KEY_BYTES,
  LEDGER_SALT_BYTES,
  MAX_PASSPHRASE_LENGTH,
  MIN_PASSPHRASE_LENGTH,
} from '../../../src/config-crypto';
import { deriveLedgerKey, newKeyId, newSalt } from '../../../src/crypto/kdf';

/** An invented passphrase; no test uses a real one. */
const PASSPHRASE = 'correct horse battery staple';
const SALT = Uint8Array.from({ length: LEDGER_SALT_BYTES }, (_, i) => i + 1);
/** Fewer rounds than the ledger uses, where a test compares keys rather than the default. */
const FEW = 1_000;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('deriveLedgerKey', () => {
  it('is PBKDF2-SHA256 at 600,000 rounds by default, as Node computes it, giving a 256-bit key', async () => {
    expect(LEDGER_KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    const key = await deriveLedgerKey(PASSPHRASE, SALT, 'a1b2c3d4e5f6');
    const expected = pbkdf2Sync(PASSPHRASE, SALT, 600_000, LEDGER_KEY_BYTES, 'sha256');
    expect(key.bytes.length).toBe(LEDGER_KEY_BYTES);
    expect(hex(key.bytes)).toBe(expected.toString('hex'));
    expect(key.id).toBe('a1b2c3d4e5f6');
  });

  it('takes the rounds it is given', async () => {
    const key = await deriveLedgerKey(PASSPHRASE, SALT, 'id', FEW);
    expect(hex(key.bytes)).toBe(
      pbkdf2Sync(PASSPHRASE, SALT, FEW, LEDGER_KEY_BYTES, 'sha256').toString('hex'),
    );
  });

  it('gives one key for a passphrase typed composed or decomposed (NFC)', async () => {
    const composed = 'caf\u00e9 au lait, s\u2019il vous pla\u00eet';
    const decomposed = 'cafe\u0301 au lait, s\u2019il vous plai\u0302t';
    expect(composed).not.toBe(decomposed);
    const one = await deriveLedgerKey(composed, SALT, 'id', FEW);
    const two = await deriveLedgerKey(decomposed, SALT, 'id', FEW);
    expect(hex(one.bytes)).toBe(hex(two.bytes));
  });

  it('gives another key for another salt or another passphrase', async () => {
    const base = hex((await deriveLedgerKey(PASSPHRASE, SALT, 'id', FEW)).bytes);
    const otherSalt = Uint8Array.from(SALT, (byte) => byte ^ 0xff);
    expect(hex((await deriveLedgerKey(PASSPHRASE, otherSalt, 'id', FEW)).bytes)).not.toBe(base);
    expect(hex((await deriveLedgerKey(`${PASSPHRASE}!`, SALT, 'id', FEW)).bytes)).not.toBe(base);
  });
});

describe('salts, ids and passphrase bounds', () => {
  it('makes a fresh 16-byte salt and a fresh 12-hex-digit id each time', () => {
    const salts = new Set(Array.from({ length: 50 }, () => hex(newSalt())));
    const ids = new Set(Array.from({ length: 50 }, () => newKeyId()));
    expect(salts.size).toBe(50);
    expect(ids.size).toBe(50);
    expect(newSalt().length).toBe(16);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/u);
  });

  it('takes passphrases of 12 characters and more, up to 1,024', () => {
    expect(MIN_PASSPHRASE_LENGTH).toBeGreaterThanOrEqual(12);
    expect(MAX_PASSPHRASE_LENGTH).toBe(1_024);
  });
});
