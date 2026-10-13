/**
 * Constants of the ledger's optional encryption at rest (sprint_6 6.5; src/crypto). UPPER_SNAKE only; apart from
 * src/config.ts so that file stays within its size, as ./config-network.ts does.
 */

/** PBKDF2-SHA256 rounds: OWASP's floor for PBKDF2 with SHA-256, the sprint's minimum. */
export const LEDGER_KDF_ITERATIONS = 600_000;
/** The install's own random salt, made when encryption is turned on and again at each new passphrase. */
export const LEDGER_SALT_BYTES = 16;
/** A 256-bit AES key. */
export const LEDGER_KEY_BYTES = 32;
/** AES-GCM's 96-bit nonce, fresh from the browser's random source for every value sealed. */
export const LEDGER_IV_BYTES = 12;
/** AES-GCM's 128-bit tag, at the end of every ciphertext. */
export const GCM_TAG_BYTES = 16;
/** A key's id, carried by every value it seals, so a passphrase change knows which rows it has not reached. */
export const LEDGER_KEY_ID_BYTES = 6;
/** The shortest passphrase taken: long enough that a copied profile is not opened by guessing at PBKDF2's pace. */
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 1_024;
/**
 * The ledger tables whose rows hold content (addresses, names, subjects, amounts, merchants, a calendar's events, the
 * person's marks and reasons, the model's notes): sealed while encryption is on (docs/privacy-architecture.md §5).
 * The others hold ids, hashes, codes, counts and instants only, and stay as they are.
 */
export const SEALED_TABLES: readonly string[] = Object.freeze([
  'requests',
  'claims',
  'observations',
  'grants',
  'receipts',
  'calendarSnapshots',
  'receiptInputs',
  'digests',
  'modelAnswers',
]);
/** Rows a sealing job rewrites per transaction, and so per step it resumes from. */
export const SEAL_JOB_PAGE = 200;
/**
 * Failed steps of a job, in a row, after which the grace alarm stops retrying it and waits for the person's Try again
 * (tech review TECH-2): a fault that passes is retried; one that stays is said, never retried for ever.
 */
export const MAX_JOB_TRIES = 3;
/**
 * While the ledger is unlocked, how often the service worker calls a cheap extension API, which restarts Chrome's
 * 30-second idle timer (Chrome 110 and later), so it is not stopped, and the ledger locked, while the person uses it
 * (src/background/keep-awake.ts).
 */
export const KEEP_AWAKE_MS = 20_000;
/** The fewest and most PBKDF2 rounds a stored key may name: the sprint's floor, and a bound on the work one unlock does. */
export const MIN_KDF_ITERATIONS = 600_000;
export const MAX_KDF_ITERATIONS = 6_000_000;
/**
 * The storage buckets the ledger lives in (Sprint 6 close, security review SEC-1; src/ledger/place.ts), this and a
 * generation: `ledger-1`, `ledger-2`. A rebuild (src/ledger/rebuild.ts) copies the rows into the next one and deletes
 * the one before, and with it every older copy of a row in Chrome's files.
 */
export const LEDGER_BUCKET_PREFIX = 'ledger-';
/** Rows the rebuild copies per transaction: read whole, a page of raw rows a couple of MB at most. */
export const REBUILD_PAGE = 2_000;
