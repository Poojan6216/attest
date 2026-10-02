/**
 * Hashing and canonical JSON (docs/grading.md §10). Pure and synchronous.
 *
 * Canonical JSON: object keys sorted by UTF-16 code unit; arrays kept in order (callers sort set-like
 * arrays first); `undefined` properties dropped; strings exactly as `JSON.stringify`; numbers in
 * JavaScript's shortest round-trip form with `-0` written as `0`. Values JSON cannot represent
 * faithfully (NaN, ±Infinity, `undefined` in an array, bigint, functions, symbols, non-plain objects)
 * throw, so two different inputs can never canonicalise to the same text.
 */
import { idFromHash } from './base32';
import { sha256, toHex, utf8 } from './sha256';

export { idFromHash };

export type HashErrorCode = 'non_finite_number' | 'unsupported_value';

export class HashError extends Error {
  constructor(readonly code: HashErrorCode) {
    super(`canonicalJson: ${code}`);
    this.name = 'HashError';
  }
}

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text`. */
export function sha256Hex(text: string): string {
  return toHex(sha256(utf8(text)));
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new HashError('non_finite_number');
  return Object.is(value, -0) ? '0' : JSON.stringify(value);
}

function canonicalArray(values: readonly unknown[]): string {
  const parts = values.map((item) => {
    if (item === undefined) throw new HashError('unsupported_value');
    return canonicalJson(item);
  });
  return `[${parts.join(',')}]`;
}

function canonicalObject(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const item = value[key];
    if (item !== undefined) parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(',')}}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return canonicalNumber(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      if (Array.isArray(value)) return canonicalArray(value);
      if (isPlainObject(value)) return canonicalObject(value);
      throw new HashError('unsupported_value');
    default:
      throw new HashError('unsupported_value');
  }
}

/** SHA-256 of the canonical JSON of `value`. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
