import { createHash } from 'node:crypto';

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { IdError } from '../../../src/core/base32';
import { canonicalJson, HashError, hashCanonical, idFromHash, sha256Hex } from '../../../src/core/hash';
import { utf8 } from '../../../src/core/sha256';

describe('sha256Hex: FIPS 180-4 / NIST test vectors', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('%j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('one million "a" (multi-block, long-message vector)', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it.each([55, 56, 57, 63, 64, 65, 119, 120, 128])('padding boundary at %i bytes matches Node', (length) => {
    const input = 'x'.repeat(length);
    expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
  });
});

describe('utf8', () => {
  it.each([
    ['A', [0x41]],
    ['é', [0xc3, 0xa9]],
    ['€', [0xe2, 0x82, 0xac]],
    ['𝐩', [0xf0, 0x9d, 0x90, 0xa9]],
    ['\ud800', [0xef, 0xbf, 0xbd]],
    ['\udc00x', [0xef, 0xbf, 0xbd, 0x78]],
  ])('%j encodes like Node', (input, bytes) => {
    expect([...utf8(input)]).toEqual(bytes);
    expect([...utf8(input)]).toEqual([...Buffer.from(input, 'utf8')]);
  });
});

describe('canonicalJson', () => {
  it('sorts keys by code unit at every depth and drops undefined properties', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined }, B: true })).toBe(
      '{"B":true,"a":{"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('writes -0 as 0 and numbers in shortest round-trip form', () => {
    expect(canonicalJson([-0, 0.1, 1e21, 5e-7, 123456789012])).toBe('[0,0.1,1e+21,5e-7,123456789012]');
  });

  it('escapes strings exactly as JSON.stringify', () => {
    const s = 'quote " backslash \\ newline \n tab \t unicode é   lone \ud800';
    expect(canonicalJson(s)).toBe(JSON.stringify(s));
  });

  it.each([
    [Number.NaN, 'non_finite_number'],
    [Number.POSITIVE_INFINITY, 'non_finite_number'],
    [{ a: Number.NEGATIVE_INFINITY }, 'non_finite_number'],
    [[1, undefined], 'unsupported_value'],
    [10n, 'unsupported_value'],
    [new Date(0), 'unsupported_value'],
    [new Map(), 'unsupported_value'],
    [() => 1, 'unsupported_value'],
    [undefined, 'unsupported_value'],
  ])('throws on %s', (value, code) => {
    expect(() => canonicalJson(value)).toThrow(HashError);
    try {
      canonicalJson(value);
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  it('accepts objects without a prototype', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.k = 'v';
    expect(canonicalJson(bare)).toBe('{"k":"v"}');
  });

  it('hashCanonical is sha256 of the canonical text', () => {
    expect(hashCanonical({ b: 2, a: 1 })).toBe(sha256Hex('{"a":1,"b":2}'));
  });
});

describe('idFromHash', () => {
  const Ulid = z.ulid();

  it('renders two zero bits + the first 128 bits as a valid uppercase ULID', () => {
    const hex = sha256Hex('claim:1');
    const id = idFromHash(hex);
    expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(Ulid.safeParse(id).success).toBe(true);
    expect(BigInt(`0x${hex.slice(0, 32)}`)).toBe(
      Array.from(id, (ch) => ch).reduce(
        (acc, ch) => acc * 32n + BigInt('0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(ch)),
        0n,
      ),
    );
  });

  it('is deterministic and distinct for distinct hashes', () => {
    expect(idFromHash(sha256Hex('a'))).toBe(idFromHash(sha256Hex('a')));
    expect(idFromHash(sha256Hex('a'))).not.toBe(idFromHash(sha256Hex('b')));
  });

  it('handles the extremes of the 128-bit range', () => {
    expect(idFromHash('0'.repeat(64))).toBe('0'.repeat(26));
    expect(idFromHash('f'.repeat(64))).toBe(`7${'Z'.repeat(25)}`);
  });

  it.each(['', 'abc', 'G'.repeat(64), 'A'.repeat(64), 'a'.repeat(63)])('rejects %j', (bad) => {
    expect(() => idFromHash(bad)).toThrow(IdError);
  });
});
