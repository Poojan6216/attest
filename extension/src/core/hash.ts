/**
 * Hashing and canonical JSON (docs/grading.md §10). Pure and synchronous.
 *
 * Canonical JSON: object keys sorted by UTF-16 code unit; arrays kept in order (callers sort set-like
 * arrays first); `undefined` properties dropped; strings exactly as `JSON.stringify`; numbers in
 * JavaScript's shortest round-trip form with `-0` written as `0`. Values JSON cannot represent
 * faithfully (NaN, ±Infinity, `undefined` in an array, bigint, functions, symbols, non-plain objects)
 * throw, so two different inputs can never canonicalise to the same text.
 *
 * `memoHash` remembers the canonical hash of an object (a batch's grant or coverage, §3: "sub-hashes are computed
 * once per batch") while everything canonical JSON reads of it is unchanged, so a memo never changes a result.
 */
import { idFromHash } from './base32';
import { sha256Utf8Hex } from './sha256';

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
  return sha256Utf8Hex(text);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new HashError('non_finite_number');
  return Object.is(value, -0) ? '0' : JSON.stringify(value);
}

/**
 * Items joined by commas. A hole in a sparse array is written as nothing (as `Array#join` writes it), while an
 * `undefined` item throws.
 */
function canonicalArray(values: readonly unknown[]): string {
  let out = '[';
  for (let i = 0; i < values.length; i += 1) {
    if (i > 0) out += ',';
    const item = values[i];
    if (item !== undefined) out += canonicalJson(item);
    else if (i in values) throw new HashError('unsupported_value');
  }
  return `${out}]`;
}

function canonicalObject(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  let out = '{';
  for (const key of keys) {
    const item = value[key];
    if (item === undefined) continue;
    if (out.length > 1) out += ',';
    out += `${JSON.stringify(key)}:${canonicalJson(item)}`;
  }
  return `${out}}`;
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

// ── Per-object hash memo ────────────────────────────────────────────────────────────────────────

/**
 * Markers in a shape record: an array (then its length), a hole in a sparse array (which canonical JSON writes
 * as nothing, while an `undefined` item throws), and a plain object (then its prototype and key count).
 */
const ARRAY = Symbol('array');
const HOLE = Symbol('hole');
const OBJECT = Symbol('object');

/**
 * Everything canonical JSON reads of `value`, flattened: primitives as themselves, an array as its marker,
 * length and items, a plain object as its marker, prototype, key count, then each own key and its value. Two
 * values with equal records (`Object.is`, token by token) have the same canonical JSON.
 */
function recordShape(value: unknown, out: unknown[]): void {
  if (typeof value !== 'object' || value === null) {
    out.push(value);
  } else if (Array.isArray(value)) {
    out.push(ARRAY, value.length);
    for (let i = 0; i < value.length; i += 1) {
      if (i in value) recordShape(value[i], out);
      else out.push(HOLE);
    }
  } else if (isPlainObject(value)) {
    const keys = Object.keys(value);
    out.push(OBJECT, Object.getPrototypeOf(value), keys.length);
    for (const key of keys) {
      out.push(key);
      recordShape(value[key], out);
    }
  } else {
    // canonicalJson throws for it, so no hash of it is ever remembered; record something no check matches.
    out.push(Symbol('opaque'));
  }
}

/**
 * Whether `value` still matches the record from index `at` on: the index just past its record, or -1 at the
 * first difference. Allocates nothing.
 */
function matchAt(value: unknown, shape: readonly unknown[], at: number): number {
  if (typeof value !== 'object' || value === null) return Object.is(shape[at], value) ? at + 1 : -1;
  if (Array.isArray(value)) return matchArray(value, shape, at);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (shape[at] !== OBJECT || !isPlainObject(value)) return -1;
  let next = at + 1;
  if (shape[next] !== prototype) return -1;
  next += 1;
  const count = shape[next];
  next += 1;
  let seen = 0;
  // Every enumerable key, inherited ones included: the record holds the own keys alone (as canonical JSON reads
  // them), so an inherited key, like any key added or removed, is a difference and the hash is recomputed.
  for (const key in value) {
    if (shape[next] !== key) return -1;
    next += 1;
    const item = value[key];
    // A primitive is compared here, without a call: an observer entry is seven of them.
    if (typeof item !== 'object' || item === null) next = Object.is(shape[next], item) ? next + 1 : -1;
    else next = matchAt(item, shape, next);
    if (next < 0) return -1;
    seen += 1;
  }
  return seen === count ? next : -1;
}

function matchArray(values: readonly unknown[], shape: readonly unknown[], at: number): number {
  if (shape[at] !== ARRAY) return -1;
  let next = at + 1;
  if (shape[next] !== values.length) return -1;
  next += 1;
  for (let i = 0; i < values.length && next >= 0; i += 1) {
    const item = values[i];
    if (item === undefined && !(i in values)) next = shape[next] === HOLE ? next + 1 : -1;
    else next = matchAt(item, shape, next);
  }
  return next;
}

interface HashEntry<Value> {
  readonly shape: readonly unknown[];
  readonly hash: Value;
}

/** A weakly held memo of canonical hashes, keyed by object identity. */
export type HashMemo<Key extends object, Value = string> = WeakMap<Key, HashEntry<Value>>;

/**
 * `brand(sha256Hex(canonicalJson(canonical(key))))`, remembered for `key` while everything canonical JSON reads
 * of `key` is unchanged: `canonical` must read `key` only through its own enumerable properties (as canonical
 * JSON does), so an object edited in place is hashed again, never from its old fields. `brand` (a schema parse
 * of the hex, say) runs once per computed hash. Throws like canonicalJson or `brand`, and then remembers nothing.
 */
export function memoHash<Key extends object, Value>(
  memo: HashMemo<Key, Value>,
  key: Key,
  canonical: (key: Key) => unknown,
  brand: (hex: string) => Value,
): Value {
  const held = memo.get(key);
  if (held !== undefined) {
    if (matchAt(key, held.shape, 0) === held.shape.length) return held.hash;
  }
  const hash = brand(sha256Hex(canonicalJson(canonical(key))));
  const shape: unknown[] = [];
  recordShape(key, shape);
  memo.set(key, { shape, hash });
  return hash;
}
