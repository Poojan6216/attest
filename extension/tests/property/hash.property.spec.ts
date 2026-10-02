import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { IdError } from '../../src/core/base32';
import { canonicalJson, idFromHash, sha256Hex } from '../../src/core/hash';

/** The §10 definition, as `idFromHash` computed it before it dropped BigInt: the reference it must equal. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function idFromHashBigInt(hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new IdError();
  let value = BigInt(`0x${hex.slice(0, 32)}`);
  let id = '';
  for (let i = 0; i < 26; i += 1) {
    id = (CROCKFORD[Number(value & 31n)] ?? '0') + id;
    value >>= 5n;
  }
  return id;
}

const hexDigit = fc.constantFrom(...Array.from('0123456789abcdef'));

describe('idFromHash (property)', () => {
  it('equals the BigInt definition for random hashes and for hashes of random text', () => {
    const randomHex = fc.array(hexDigit, { minLength: 64, maxLength: 64 }).map((digits) => digits.join(''));
    const hashed = fc.string({ unit: 'binary', maxLength: 100 }).map((text) => sha256Hex(text));
    fc.assert(
      fc.property(fc.oneof(randomHex, hashed), (hex) => {
        expect(idFromHash(hex)).toBe(idFromHashBigInt(hex));
      }),
      { numRuns: 5000 },
    );
  });

  it('refuses exactly what the BigInt definition refuses (length, case, any non-hex digit anywhere)', () => {
    const anyUnit = fc.string({ unit: 'binary', minLength: 1, maxLength: 1 });
    const corrupted = fc
      .tuple(fc.array(hexDigit, { minLength: 64, maxLength: 64 }), fc.nat(63), anyUnit)
      .map(([digits, at, unit]) => [...digits.slice(0, at), unit, ...digits.slice(at + 1)].join(''));
    const anyText = fc.string({ unit: 'binary', maxLength: 70 });
    fc.assert(
      fc.property(fc.oneof(corrupted, anyText), (text) => {
        const reference = (() => {
          try {
            return idFromHashBigInt(text);
          } catch (error) {
            return error instanceof IdError ? 'IdError' : 'other';
          }
        })();
        if (reference === 'IdError') expect(() => idFromHash(text)).toThrow(IdError);
        else expect(idFromHash(text)).toBe(reference);
      }),
      { numRuns: 5000 },
    );
  });
});

describe('hash (property)', () => {
  it('sha256Hex equals Node crypto for any string, including lone surrogates and astral characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
      }),
      { numRuns: 2000 },
    );
  });

  it('sha256Hex equals Node crypto for long mostly-ASCII text, multi-byte code points at any block offset', () => {
    // The fast path reads whole 64-byte ASCII blocks straight into words; a multi-byte code point or a lone
    // surrogate anywhere shifts every later block off the boundary, and the path must resume after it.
    const ascii = fc.string({ unit: 'grapheme-ascii', maxLength: 200 });
    const other = fc.string({ unit: 'binary', minLength: 1, maxLength: 3 });
    fc.assert(
      fc.property(fc.array(fc.oneof(ascii, ascii, other), { maxLength: 12 }), (parts) => {
        const text = parts.join('');
        expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
      }),
      { numRuns: 1000 },
    );
  });

  it('canonicalJson is invariant under key order and parses back to the same value', () => {
    const json = fc.jsonValue({ maxDepth: 4 });
    fc.assert(
      fc.property(json, (value) => {
        const text = canonicalJson(value);
        const reordered = JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
          v !== null && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).reverse())
            : v,
        ) as unknown;
        expect(canonicalJson(reordered)).toBe(text);
        // -0 is written as 0 by design (docs/grading.md §10), exactly as JSON.stringify does.
        expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      { numRuns: 1000 },
    );
  });
});
