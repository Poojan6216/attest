/**
 * Sealing a value (src/crypto/seal.ts; sprint_6 6.5), 1,000 runs each:
 *  - any JSON value opens back to itself under its own key and additional data (compared as JSON: the format seals
 *    JSON, so -0 comes back 0, as JSON.stringify writes it);
 *  - it never opens under another key, under other additional data, or with any one byte of its nonce or ciphertext
 *    changed, whichever byte and however changed;
 *  - two seals of one value never share a nonce.
 * Keys, values and additional data are generated; nothing here is a real secret.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { LedgerKey } from '../../src/crypto/kdf';
import { open, seal } from '../../src/crypto/seal';

const RUNS = 1_000;

const keyArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes): LedgerKey => ({ id: 'aaaaaaaaaaaa', bytes: Uint8Array.from(bytes) }));
const valueArb = fc.jsonValue();
const aadArb = fc.string({ maxLength: 80 });

/** `bytes` with the byte at `at` (mod its length) changed by `mask`, never zero. */
function flipped(bytes: Uint8Array, at: number, mask: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  const index = at % copy.length;
  copy[index] = (copy[index] ?? 0) ^ mask;
  return copy;
}

describe('seal and open, for any value', () => {
  it('opens to the value sealed, under its own key and additional data', () => {
    fc.assert(
      fc.property(keyArb, aadArb, valueArb, (key, aad, value) => {
        expect(JSON.stringify(open(key, aad, seal(key, aad, value)))).toBe(JSON.stringify(value));
      }),
      { numRuns: RUNS },
    );
  });

  it('never opens under another key or other additional data', () => {
    fc.assert(
      fc.property(keyArb, keyArb, aadArb, aadArb, valueArb, (key, other, aad, otherAad, value) => {
        fc.pre(other.bytes.some((byte, i) => byte !== key.bytes[i]));
        fc.pre(aad !== otherAad);
        const sealed = seal(key, aad, value);
        expect(() => open(other, aad, sealed)).toThrow();
        expect(() => open(key, otherAad, sealed)).toThrow();
      }),
      { numRuns: RUNS },
    );
  });

  it('never opens with one byte of its nonce or ciphertext changed', () => {
    const mask = fc.integer({ min: 1, max: 255 });
    fc.assert(
      fc.property(
        keyArb,
        aadArb,
        valueArb,
        fc.nat(),
        mask,
        fc.boolean(),
        (key, aad, value, at, by, inNonce) => {
          const sealed = seal(key, aad, value);
          const changed = inNonce
            ? { ...sealed, iv: flipped(sealed.iv, at, by) }
            : { ...sealed, ct: flipped(sealed.ct, at, by) };
          expect(() => open(key, aad, changed)).toThrow();
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('gives two seals of one value two nonces', () => {
    fc.assert(
      fc.property(keyArb, aadArb, valueArb, (key, aad, value) => {
        const [one, two] = [seal(key, aad, value), seal(key, aad, value)];
        expect(Buffer.from(one.iv).equals(Buffer.from(two.iv))).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});
