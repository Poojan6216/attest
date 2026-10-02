/**
 * Crockford base32 for ids derived from hashes (docs/grading.md §10).
 *
 * `idFromHash` renders two zero bits followed by the first 128 bits of a SHA-256 as 26 uppercase Crockford
 * characters. That is exactly the shape of a ULID (130 bits, first character 0–7), so the result passes the
 * schema's ULID check, but its "timestamp" part is meaningless: these ids are deterministic, not ordered.
 * This file is exempt from the core no-literal rule: the numbers are the encoding's widths.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 26;
const BITS_PER_CHAR = 5n;
const CHAR_MASK = 31n;
const HASH_HEX_PREFIX = 32;

export class IdError extends Error {
  readonly code = 'invalid_hash';
  constructor() {
    super('idFromHash expects a lowercase hex SHA-256');
    this.name = 'IdError';
  }
}

/** Deterministic ULID-shaped id from a lowercase hex SHA-256. */
export function idFromHash(hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new IdError();
  let value = BigInt(`0x${hex.slice(0, HASH_HEX_PREFIX)}`);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i += 1) {
    id = (ALPHABET[Number(value & CHAR_MASK)] ?? '0') + id;
    value >>= BITS_PER_CHAR;
  }
  return id;
}
