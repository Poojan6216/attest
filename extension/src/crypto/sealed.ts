/**
 * The form of a sealed value (sprint_6 6.5; ./seal.ts makes and opens one), apart from the cipher: telling a sealed row
 * from a plain one loads no cipher code, so a ledger that was never encrypted never loads it (Sprint 6 close, tech
 * review TECH-1; ./cipher.ts).
 */

/** A sealed value: the format's version, the id of the key that sealed it, its nonce, its ciphertext and tag. */
export interface Sealed {
  readonly v: 1;
  readonly k: string;
  readonly iv: Uint8Array;
  readonly ct: Uint8Array;
}

/** Whether `value` is a sealed value as ./seal.ts writes one. */
export function isSealed(value: unknown): value is Sealed {
  if (typeof value !== 'object' || value === null) return false;
  return (
    Reflect.get(value, 'v') === 1 &&
    typeof Reflect.get(value, 'k') === 'string' &&
    Reflect.get(value, 'iv') instanceof Uint8Array &&
    Reflect.get(value, 'ct') instanceof Uint8Array
  );
}
