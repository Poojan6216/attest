/**
 * The ledger's encryption state changed (sprint_6 6.5; ./crypto-state.ts), by the service worker only, the ledger's one
 * writer: each change is one transaction on `meta`, so a stop of the worker between two leaves the ledger in one
 * state or the next, never between. Each starts a job ./crypto-job.ts runs, which rewrites every row of the sealed
 * tables and then clears the job. Never a passphrase or a key in the clear: a key's id, its salt, its rounds, its
 * check, and the key before sealed under the new one.
 */
import { SEALED_TABLES } from '../config-crypto';
import { CRYPTO_KEYS, CRYPTO_PREFIX, type CryptoJob } from './crypto-state';
import type { LedgerDb } from './db';
import { MetaEntry } from './types';

/** What `meta` keeps of a new key. */
export interface KeyRecord {
  readonly keyId: string;
  /** Base64. */
  readonly salt: string;
  readonly iterations: number;
  readonly check: string;
}

const FIRST_TABLE = SEALED_TABLES[0] ?? 'requests';

async function putMeta(
  db: LedgerDb,
  entries: Readonly<Record<string, string | number | boolean>>,
): Promise<void> {
  await db.meta.bulkPut(Object.entries(entries).map(([key, value]) => MetaEntry.parse({ key, value })));
}

async function startJob(
  db: LedgerDb,
  job: CryptoJob,
  entries: Readonly<Record<string, string | number | boolean>>,
): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await db.meta.bulkDelete([CRYPTO_KEYS.JOB_AFTER, CRYPTO_KEYS.PREVIOUS]);
    await putMeta(db, { ...entries, [CRYPTO_KEYS.JOB]: job, [CRYPTO_KEYS.JOB_TABLE]: FIRST_TABLE });
  });
}

const keyEntries = (key: KeyRecord) => ({
  [CRYPTO_KEYS.KEY_ID]: key.keyId,
  [CRYPTO_KEYS.SALT]: key.salt,
  [CRYPTO_KEYS.ITERATIONS]: key.iterations,
  [CRYPTO_KEYS.CHECK]: key.check,
});

/** Turns encryption on under `key`: every row written from now is sealed, and the job seals the rest. */
export async function beginSealing(db: LedgerDb, key: KeyRecord): Promise<void> {
  await startJob(db, 'seal', { [CRYPTO_KEYS.SEALING]: true, ...keyEntries(key) });
}

/**
 * A new passphrase: `key` replaces the current key, which is kept sealed under it (`previous`) until the job has sealed
 * every row again under `key`.
 */
export async function beginResealing(db: LedgerDb, key: KeyRecord, previous: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await startJob(db, 'reseal', keyEntries(key));
    await putMeta(db, { [CRYPTO_KEYS.PREVIOUS]: previous });
  });
}

/** Turns encryption off: rows written from now are plain, and the job opens every sealed row for good. */
export async function beginUnsealing(db: LedgerDb): Promise<void> {
  await startJob(db, 'unseal', {});
}

/** The job is done: its place and the key before go; once encryption is off, every `crypto.` key goes. */
export async function finishJob(db: LedgerDb, job: CryptoJob): Promise<void> {
  if (job === 'unseal') {
    await db.meta.where('key').startsWith(CRYPTO_PREFIX).delete();
    return;
  }
  await db.meta.bulkDelete([
    CRYPTO_KEYS.JOB,
    CRYPTO_KEYS.JOB_TABLE,
    CRYPTO_KEYS.JOB_AFTER,
    CRYPTO_KEYS.PREVIOUS,
  ]);
}
