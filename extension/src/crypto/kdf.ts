/**
 * The ledger's key from the person's passphrase (sprint_6 6.5): PBKDF2 with SHA-256 over the passphrase in Unicode NFC
 * (one passphrase typed on two keyboards is one key), the install's own random salt, and LEDGER_KDF_ITERATIONS rounds,
 * giving a 256-bit AES key. WebCrypto does the work, natively, outside any ledger transaction.
 */
import {
  LEDGER_KDF_ITERATIONS,
  LEDGER_KEY_BYTES,
  LEDGER_KEY_ID_BYTES,
  LEDGER_SALT_BYTES,
} from '../config-crypto';
import { randomBytes, randomHex } from './bytes';

/** A key the ledger seals with, and its id, which every value it seals carries. */
export interface LedgerKey {
  readonly id: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** A fresh salt for a new passphrase. */
export const newSalt = (): Uint8Array<ArrayBuffer> => randomBytes(LEDGER_SALT_BYTES);

/** A fresh key id for a new passphrase. */
export const newKeyId = (): string => randomHex(LEDGER_KEY_ID_BYTES);

/** The key `passphrase` gives with `salt` over `iterations` rounds, as key `id`. */
export async function deriveLedgerKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  id: string,
  iterations: number = LEDGER_KDF_ITERATIONS,
): Promise<LedgerKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    LEDGER_KEY_BYTES * 8,
  );
  return { id, bytes: new Uint8Array(bits) };
}
