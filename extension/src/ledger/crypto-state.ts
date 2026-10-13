/**
 * The ledger's encryption state (sprint_6 6.5), in its `meta` table, which is never sealed: whether encryption is on,
 * the current key's id, the install's salt and PBKDF2 rounds, the key check that tells a right passphrase from a wrong
 * one before any row is read, during a passphrase change the key before (sealed under the new one), and where a
 * sealing job stands, so it resumes after the service worker stops. No key is ever here in the clear: keys live in
 * memory only (src/crypto/keyring.ts). `loadKeyring` sets this context's keyring from this state and the keys this
 * context holds or is given.
 */
import { lockKeyring, setKeyring, type HeldKeys } from '../crypto/keyring';
import type { LedgerDb } from './db';

/** The prefix of every encryption key in `meta`. */
export const CRYPTO_PREFIX = 'crypto.';

/**
 * Whether a `meta` row is part of the encryption state. An export leaves these out (./export.ts, ./export-file.ts;
 * Sprint 6 close, security review SEC-4): the export is written opened, so they mean nothing there, and the salt, the
 * rounds and the key check together would let whoever holds the file test guesses of the passphrase.
 */
export const isCryptoEntry = (entry: { readonly key: string }): boolean =>
  entry.key.startsWith(CRYPTO_PREFIX);
export const CRYPTO_KEYS = Object.freeze({
  /** True while encryption is on. */
  SEALING: 'crypto.sealing',
  KEY_ID: 'crypto.keyId',
  /** The install's salt for the current passphrase, base64. */
  SALT: 'crypto.salt',
  ITERATIONS: 'crypto.iterations',
  /** The current key's check (src/crypto/seal.ts `keyCheck`). */
  CHECK: 'crypto.check',
  /** During a passphrase change, the key before, sealed under the current one (src/crypto/seal.ts `wrapKey`). */
  PREVIOUS: 'crypto.previous',
  /** The sealing job under way, if any: `seal` (turning on), `reseal` (a new passphrase) or `unseal` (turning off). */
  JOB: 'crypto.job',
  /** The table the job is in, and the key of the last row it rewrote there, as JSON. */
  JOB_TABLE: 'crypto.jobTable',
  JOB_AFTER: 'crypto.jobAfter',
  /**
   * True from the end of a job that sealed every row until the ledger's database is rebuilt (./rebuild.ts; Sprint 6
   * close, security review SEC-1), so Chrome's files keep no older copy of a row.
   */
  REBUILD: 'crypto.rebuild',
});

export type CryptoJob = 'seal' | 'reseal' | 'unseal';
export const isCryptoJob = (value: unknown): value is CryptoJob =>
  value === 'seal' || value === 'reseal' || value === 'unseal';

/** The ledger's encryption state as `meta` holds it; a value of the wrong kind reads as absent. */
export interface CryptoState {
  readonly on: boolean;
  readonly keyId?: string;
  readonly salt?: string;
  readonly iterations?: number;
  readonly check?: string;
  readonly previous?: string;
  readonly job?: CryptoJob;
  readonly jobTable?: string;
  readonly jobAfter?: string;
  /** A job sealed every row, and the ledger's database is still to be rebuilt. */
  readonly rebuild?: true;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The ledger's encryption state, read in one go. */
export async function readCryptoState(db: LedgerDb): Promise<CryptoState> {
  const rows = await db.meta.where('key').startsWith(CRYPTO_PREFIX).toArray();
  const value = (key: string): unknown => rows.find((row) => row.key === key)?.value;
  const iterations = value(CRYPTO_KEYS.ITERATIONS);
  const job = value(CRYPTO_KEYS.JOB);
  const fields = {
    keyId: text(value(CRYPTO_KEYS.KEY_ID)),
    salt: text(value(CRYPTO_KEYS.SALT)),
    iterations: typeof iterations === 'number' && Number.isSafeInteger(iterations) ? iterations : undefined,
    check: text(value(CRYPTO_KEYS.CHECK)),
    previous: text(value(CRYPTO_KEYS.PREVIOUS)),
    job: isCryptoJob(job) ? job : undefined,
    jobTable: text(value(CRYPTO_KEYS.JOB_TABLE)),
    jobAfter: text(value(CRYPTO_KEYS.JOB_AFTER)),
    rebuild: value(CRYPTO_KEYS.REBUILD) === true ? (true as const) : undefined,
  };
  const present = Object.entries(fields).filter(([, field]) => field !== undefined);
  return { on: value(CRYPTO_KEYS.SEALING) === true, ...Object.fromEntries(present) };
}

/** Whether the ledger may hold sealed rows: encryption on, or a job turning it on or off not finished. */
export const isGuarded = (state: CryptoState): boolean => state.on || state.job !== undefined;

/** Whether rows written now are sealed: encryption on, and not being turned off. */
export const sealsNow = (state: CryptoState): boolean => state.on && state.job !== 'unseal';

/**
 * Sets this context's keyring from `db`'s state, with the keys `keys` gives: asked only while the ledger may hold sealed
 * rows, so a page never wakes the service worker for a ledger that is not encrypted. Returns the state it read. While
 * it reads, and if a read fails, the keyring is locked (Sprint 6 close, security review SEC-5): fail closed.
 */
export async function loadKeyring(db: LedgerDb, keys: () => Promise<HeldKeys>): Promise<CryptoState> {
  // Locked while it reads, and so after a read that fails: never the keys before a lock (SEC-5).
  lockKeyring();
  const state = await readCryptoState(db);
  const guarded = isGuarded(state);
  setKeyring({ sealing: sealsNow(state), guarded, ...(guarded ? await keys() : {}) });
  return state;
}
