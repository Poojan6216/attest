/**
 * Crockford base32 for ids derived from hashes (docs/grading.md §10).
 *
 * `idFromHash` renders two zero bits followed by the first 128 bits of a SHA-256 as 26 uppercase Crockford
 * characters. That is exactly the shape of a ULID (130 bits, first character 0–7), so the result passes the
 * schema's ULID check, but its "timestamp" part is meaningless: these ids are deterministic, not ordered.
 * This file is exempt from the core no-literal rule: the numbers are the encoding's widths.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const HEX_DIGITS = '0123456789abcdef';
const HASH_HEX_LENGTH = 64;
/** The first 128 bits of the hash: 32 hex digits. */
const HASH_HEX_PREFIX = 32;
const BITS_PER_HEX_DIGIT = 4;
const BITS_PER_CHAR = 5;
/** 128 = 3 + 25 · 5: the first character holds the top 3 bits (under the two zero bits), every other one 5. */
const FIRST_CHAR_BITS = 3;
const ASCII_LIMIT = 128;

/** Each ASCII code unit's value as a lowercase hex digit, or -1 (uppercase and every other unit are refused). */
const HEX_VALUE = new Int8Array(ASCII_LIMIT).fill(-1);
for (let digit = 0; digit < HEX_DIGITS.length; digit += 1) HEX_VALUE[HEX_DIGITS.charCodeAt(digit)] = digit;

export class IdError extends Error {
  readonly code = 'invalid_hash';
  constructor() {
    super('idFromHash expects a lowercase hex SHA-256');
    this.name = 'IdError';
  }
}

/** The value of the lowercase hex digit at `hex[i]`, or -1. */
function hexValue(hex: string, i: number): number {
  const unit = hex.charCodeAt(i);
  return unit < ASCII_LIMIT ? (HEX_VALUE[unit] ?? -1) : -1;
}

/**
 * Deterministic ULID-shaped id from a lowercase hex SHA-256: the first 128 bits read as a bit string from the
 * most significant end, cut into one 3-bit and twenty-five 5-bit groups, each written as its Crockford character.
 * Integer arithmetic only (every intermediate is below 2^9); a property test pins it to the BigInt definition.
 */
export function idFromHash(hex: string): string {
  if (hex.length !== HASH_HEX_LENGTH) throw new IdError();
  for (let i = HASH_HEX_PREFIX; i < HASH_HEX_LENGTH; i += 1) if (hexValue(hex, i) < 0) throw new IdError();
  let id = '';
  let pending = 0;
  let bits = 0;
  let width = FIRST_CHAR_BITS;
  for (let i = 0; i < HASH_HEX_PREFIX; i += 1) {
    const value = hexValue(hex, i);
    if (value < 0) throw new IdError();
    pending = (pending << BITS_PER_HEX_DIGIT) | value;
    bits += BITS_PER_HEX_DIGIT;
    if (bits >= width) {
      bits -= width;
      id += ALPHABET.charAt(pending >> bits);
      pending &= (1 << bits) - 1;
      width = BITS_PER_CHAR;
    }
  }
  return id;
}
