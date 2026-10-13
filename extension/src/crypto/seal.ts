/**
 * Sealing a value under the ledger's key (sprint_6 6.5): AES-256-GCM with a fresh 96-bit nonce from the browser's random
 * source for every value, over the value as JSON, with the row it belongs to as additional data, so a sealed value
 * moved to another row or table no longer opens. Synchronous (@noble/ciphers' AES-GCM, the same algorithm as
 * WebCrypto's), because rows are sealed and opened inside IndexedDB transactions, which end at the first wait on
 * anything but IndexedDB (./middleware.ts). A wrong key or a changed byte fails the tag, never yields other plaintext.
 */
import { gcm } from '@noble/ciphers/aes.js';

import { LEDGER_IV_BYTES, LEDGER_KEY_BYTES } from '../config-crypto';
import { fromBase64, randomBytes, toBase64 } from './bytes';
import type { LedgerKey } from './kdf';
import type { Sealed } from './sealed';

export { isSealed, type Sealed } from './sealed';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** `value`, as JSON, sealed under `key` for `aad`. */
export function seal(key: LedgerKey, aad: string, value: unknown): Sealed {
  const iv = randomBytes(LEDGER_IV_BYTES);
  const ct = gcm(key.bytes, iv, encoder.encode(aad)).encrypt(encoder.encode(JSON.stringify(value)));
  return { v: 1, k: key.id, iv, ct };
}

/** The value `sealed` holds, opened with `key` for `aad`; throws on a wrong key, another row's value, or any change. */
export function open(key: LedgerKey, aad: string, sealed: Sealed): unknown {
  const plain = gcm(key.bytes, Uint8Array.from(sealed.iv), encoder.encode(aad)).decrypt(
    Uint8Array.from(sealed.ct),
  );
  return JSON.parse(decoder.decode(plain));
}

/** What the key check seals: opening it proves a passphrase gives the ledger's key, before any row is read. */
const CHECK_TEXT = 'attest-ledger-key-check-v1';
const CHECK_AAD = 'crypto:check';

/** The key check for `key`, as text for `meta`: its nonce and its ciphertext, base64, joined by a dot. */
export function keyCheck(key: LedgerKey): string {
  const sealed = seal(key, CHECK_AAD, CHECK_TEXT);
  return `${toBase64(sealed.iv)}.${toBase64(sealed.ct)}`;
}

/** Whether `key` opens `check`: true only for the key that made it. */
export function opensCheck(key: LedgerKey, check: string): boolean {
  const [iv, ct] = check.split('.');
  if (iv === undefined || ct === undefined) return false;
  try {
    return open(key, CHECK_AAD, { v: 1, k: key.id, iv: fromBase64(iv), ct: fromBase64(ct) }) === CHECK_TEXT;
  } catch {
    return false;
  }
}

const WRAP_AAD = 'crypto:previous';

/**
 * `inner` sealed under `outer`, as text for `meta`: its id, then the nonce and ciphertext, base64, joined by dots. A
 * passphrase change keeps the key before this way (src/ledger/crypto-state.ts `PREVIOUS`), so the rows it has not
 * reached yet still open after a restart, with the new passphrase alone.
 */
export function wrapKey(outer: LedgerKey, inner: LedgerKey): string {
  const sealed = seal(outer, `${WRAP_AAD}:${inner.id}`, toBase64(inner.bytes));
  return `${inner.id}.${toBase64(sealed.iv)}.${toBase64(sealed.ct)}`;
}

/** The key `wrapped` holds, opened with `outer`; undefined for a wrong key or a changed or malformed value. */
export function unwrapKey(outer: LedgerKey, wrapped: string): LedgerKey | undefined {
  const [id, iv, ct, ...rest] = wrapped.split('.');
  if (id === undefined || iv === undefined || ct === undefined || rest.length > 0) return undefined;
  try {
    const bytes = open(outer, `${WRAP_AAD}:${id}`, {
      v: 1,
      k: outer.id,
      iv: fromBase64(iv),
      ct: fromBase64(ct),
    });
    if (typeof bytes !== 'string') return undefined;
    const key = fromBase64(bytes);
    return key.length === LEDGER_KEY_BYTES ? { id, bytes: key } : undefined;
  } catch {
    return undefined;
  }
}

/** Text `sealText` wrote: the sealing key's id, then the nonce and ciphertext, base64, joined by dots. */
const SEALED_TEXT = /^([0-9a-f]{12})\.([A-Za-z0-9+/]+={0,2})\.([A-Za-z0-9+/]+={0,2})$/u;

/**
 * `text` sealed under `key` for `aad`, as text: the key's id, then the nonce and ciphertext, base64, joined by dots.
 * The person's own model key is kept this way while encryption is on (src/background/byo.ts; Sprint 6 close, SEC-2).
 */
export function sealText(key: LedgerKey, aad: string, text: string): string {
  const sealed = seal(key, aad, text);
  return `${key.id}.${toBase64(sealed.iv)}.${toBase64(sealed.ct)}`;
}

/** The id of the key that sealed `value`, when it is text `sealText` wrote; undefined for anything else. */
export function sealedTextKeyId(value: string): string | undefined {
  return SEALED_TEXT.exec(value)?.[1];
}

/** The text `sealed` holds, opened with `key` for `aad`; undefined for a wrong key, or a changed or malformed value. */
export function openText(key: LedgerKey, aad: string, sealed: string): string | undefined {
  const [, id, iv, ct] = SEALED_TEXT.exec(sealed) ?? [];
  if (id !== key.id || iv === undefined || ct === undefined) return undefined;
  try {
    const text = open(key, aad, { v: 1, k: id, iv: fromBase64(iv), ct: fromBase64(ct) });
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
}
