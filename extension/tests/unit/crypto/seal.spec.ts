/**
 * Sealing a value (src/crypto/seal.ts; sprint_6 6.5): AES-256-GCM, checked against WebCrypto's as an independent
 * implementation; a fresh nonce for every value; bound to its row by the additional data; a wrong key, another row's
 * value or any changed byte fails, never yielding other plaintext; and the key check that tells a right passphrase
 * from a wrong one.
 */
import { describe, expect, it } from 'vitest';

import { fromBase64, toBase64 } from '../../../src/crypto/bytes';
import type { LedgerKey } from '../../../src/crypto/kdf';
import { isSealed, keyCheck, open, opensCheck, seal, type Sealed } from '../../../src/crypto/seal';

const keyOf = (fill: number, id = 'aaaaaaaaaaaa'): LedgerKey => ({
  id,
  bytes: Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + fill) % 256),
});
const KEY = keyOf(1);
const OTHER = keyOf(2, 'bbbbbbbbbbbb');
/** Invented values only. */
const ROW = {
  counterparty: 'alice@example.com',
  subjectHint: 'Quarterly numbers — café',
  amountCents: 1250,
  nested: { list: [1, 'two', null, true] },
};
const AAD = 'claims:"0123456789abcdef"';

const flipped = (bytes: Uint8Array, at: number): Uint8Array => {
  const copy = Uint8Array.from(bytes);
  copy[at] = (copy[at] ?? 0) ^ 0x01;
  return copy;
};

describe('seal and open', () => {
  it('opens what it sealed, whole', () => {
    const sealed = seal(KEY, AAD, ROW);
    expect(sealed).toMatchObject({ v: 1, k: KEY.id });
    expect(sealed.iv.length).toBe(12);
    expect(open(KEY, AAD, sealed)).toEqual(ROW);
  });

  it('is standard AES-256-GCM: WebCrypto opens it with the same key, nonce and additional data', async () => {
    const sealed = seal(KEY, AAD, ROW);
    const key = await crypto.subtle.importKey('raw', KEY.bytes, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(sealed.iv), additionalData: new TextEncoder().encode(AAD) },
      key,
      Uint8Array.from(sealed.ct),
    );
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual(ROW);
  });

  it('uses a fresh nonce for every value: the same value sealed twice differs', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => toBase64(seal(KEY, AAD, ROW).iv)));
    expect(nonces.size).toBe(100);
    const [one, two] = [seal(KEY, AAD, ROW), seal(KEY, AAD, ROW)];
    expect(toBase64(one.ct)).not.toBe(toBase64(two.ct));
  });

  it('holds no plaintext: no field value appears in the sealed bytes', () => {
    const sealed = seal(KEY, AAD, ROW);
    const text = Buffer.from(sealed.ct).toString('latin1');
    for (const value of ['alice', 'example.com', 'Quarterly', '1250']) expect(text).not.toContain(value);
  });

  it('fails for a wrong key, another row, another table, or any changed byte', () => {
    const sealed = seal(KEY, AAD, ROW);
    expect(() => open(OTHER, AAD, sealed)).toThrow();
    expect(() => open(KEY, 'claims:"fedcba9876543210"', sealed)).toThrow();
    expect(() => open(KEY, 'requests:"0123456789abcdef"', sealed)).toThrow();
    for (const at of [0, 5, sealed.ct.length - 1]) {
      expect(() => open(KEY, AAD, { ...sealed, ct: flipped(sealed.ct, at) })).toThrow();
    }
    expect(() => open(KEY, AAD, { ...sealed, iv: flipped(sealed.iv, 3) })).toThrow();
    expect(() => open(KEY, AAD, { ...sealed, ct: sealed.ct.slice(0, -1) })).toThrow();
  });

  it('knows a sealed value from anything else', () => {
    const sealed: Sealed = seal(KEY, AAD, ROW);
    expect(isSealed(sealed)).toBe(true);
    for (const value of [
      null,
      'sealed',
      { ...sealed, v: 2 },
      { ...sealed, k: 1 },
      { ...sealed, iv: [1, 2] },
      { ...sealed, ct: 'abc' },
      { v: 1, k: 'x' },
    ]) {
      expect(isSealed(value)).toBe(false);
    }
  });
});

describe('the key check', () => {
  it('opens with the key that made it, and with no other', () => {
    const check = keyCheck(KEY);
    expect(check).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/u);
    expect(opensCheck(KEY, check)).toBe(true);
    expect(opensCheck(OTHER, check)).toBe(false);
  });

  it('is new each time, and refuses a malformed or changed check', () => {
    expect(keyCheck(KEY)).not.toBe(keyCheck(KEY));
    const [iv = '', ct = ''] = keyCheck(KEY).split('.');
    for (const bad of [
      '',
      'abc',
      `${iv}.`,
      `.${ct}`,
      `${iv}.${toBase64(flipped(fromBase64(ct), 0))}`,
      `${iv}.!!`,
    ]) {
      expect(opensCheck(KEY, bad), bad).toBe(false);
    }
  });
});

describe('base64', () => {
  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(fromBase64(toBase64(all)))).toEqual(Array.from(all));
    expect(toBase64(new Uint8Array(0))).toBe('');
  });
});
