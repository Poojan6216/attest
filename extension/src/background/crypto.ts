/**
 * Encryption at rest in the service worker (sprint_6 6.5): the page commands that turn it on (`crypto.enable`), unlock
 * and lock the ledger (`crypto.unlock`, `crypto.lock`), change the passphrase (`crypto.change`) and turn it off
 * (`crypto.disable`), and the job each start that rewrites every row (src/ledger/crypto-job.ts), resumed at the next
 * unlock after any stop. One command at a time, so two clicks never derive two keys for one ledger.
 *
 * The keys live in this worker's memory, and in `chrome.storage.session` for the extension's pages (src/crypto/
 * session.ts), which `holdKeysHere` clears at the worker's every start: a restart of the worker locks the ledger until
 * the passphrase is typed again. While it is unlocked the worker keeps itself running (./keep-awake.ts). A passphrase is
 * checked against the ledger's key check before any row is read, so a wrong one leaves it locked and reads nothing. No
 * passphrase or key is ever logged (Hard Rule 10): a failure is logged by the command's name and the error's.
 */
import type {
  CryptoChangeMessage,
  CryptoCode,
  CryptoDisableMessage,
  CryptoEnableMessage,
  CryptoResult,
  CryptoUnlockMessage,
  LedgerTable,
} from '../bus/messages';
import {
  GCM_TAG_BYTES,
  LEDGER_IV_BYTES,
  LEDGER_KDF_ITERATIONS,
  LEDGER_SALT_BYTES,
  MAX_KDF_ITERATIONS,
  MIN_KDF_ITERATIONS,
} from '../config-crypto';
import { fromBase64, toBase64 } from '../crypto/bytes';
import { deriveLedgerKey, newKeyId, newSalt, type LedgerKey } from '../crypto/kdf';
import { isLocked, type HeldKeys } from '../crypto/keyring';
import { keyCheck, opensCheck, unwrapKey, wrapKey } from '../crypto/seal';
import { clearSessionKeys, writeSessionKeys } from '../crypto/session';
import { stepCryptoJob } from '../ledger/crypto-job';
import {
  isGuarded,
  loadKeyring,
  readCryptoState,
  type CryptoJob,
  type CryptoState,
} from '../ledger/crypto-state';
import { beginResealing, beginSealing, beginUnsealing } from '../ledger/crypto-writes';
import type { LedgerDb } from '../ledger/db';
import { LedgerError } from '../ledger/errors';
import { setKeySource } from '../ledger/shared';
import { log } from '../log';
import { sealSavedKey } from './byo';
import { keepAwake, letSleep } from './keep-awake';
import { rebuildLedger } from './rebuild';

export interface CryptoDeps {
  readonly db: () => Promise<LedgerDb>;
  /** Tells open pages what changed: `meta`, where the state and a job's place are. */
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

const OK: CryptoResult = Object.freeze({ ok: true });
const refused = (code: CryptoCode): CryptoResult => ({ ok: false, code });

/** The keys this worker unlocked: its memory is the only place they are kept (header). */
let held: HeldKeys = {};
let commands: Promise<unknown> = Promise.resolve();
let job: Promise<void> | undefined;
let afterUnlock: () => Promise<void> = () => Promise.resolve();

/**
 * What runs after each unlock, set by the worker's start (./catch-up.ts: the alarms that wait while the ledger is
 * locked, each once), so this module needs none of them.
 */
export function onUnlocked(run: () => Promise<void>): void {
  afterUnlock = run;
}

/**
 * At every start of the worker, before anything opens the ledger: this worker's memory is its key source, and the
 * copy of the keys a previous start kept for the pages goes, so the ledger is locked everywhere until it is unlocked.
 */
export function holdKeysHere(): void {
  held = {};
  setKeySource(() => Promise.resolve(held));
  // Before any command runs, and tried again once (Sprint 6 close, security review SEC-5): a copy a previous start
  // kept and this one failed to clear would leave every page unlocked.
  commands = clearSessionKeys()
    .catch(() => clearSessionKeys())
    .catch((error: unknown) => {
      log.error('crypto.session_clear_failed', { error });
    });
}

/** Forgets the keys this worker holds (Delete all data): nothing is left to unlock. */
export async function forgetKeys(): Promise<void> {
  held = {};
  letSleep();
  await clearSessionKeys();
}

/**
 * Keeps `keys` here and for the pages (none: locked), reloads this worker's keyring with them, and keeps the person's
 * saved model key as the ledger's state now asks (./byo.ts `sealSavedKey`; Sprint 6 close, SEC-2).
 */
async function hold(keys: HeldKeys, deps: CryptoDeps): Promise<void> {
  held = keys;
  await (keys.current === undefined ? clearSessionKeys() : writeSessionKeys(keys));
  await loadKeyring(await deps.db(), () => Promise.resolve(held));
  await sealSavedKey().catch((error: unknown) => {
    log.error('byo.seal_failed', { error });
  });
  // From what this worker holds now, not from what it was asked to hold (tech review TECH-6).
  if (held.current === undefined) letSleep();
  else keepAwake();
  deps.notify(['meta']);
}

/** Runs `command` after every command before it, answering `failed` when it throws (logged by name only). */
function oneAtATime(name: string, command: () => Promise<CryptoResult>): Promise<CryptoResult> {
  const run = commands.then(command).catch((error: unknown) => {
    log.error('crypto.command_failed', { command: name, error });
    return refused('failed');
  });
  commands = run;
  return run;
}

/** What a passphrase gives under the ledger's state: its key, or why not. */
type Keyed = { readonly key: LedgerKey } | { readonly refused: 'wrong_passphrase' | 'damaged' };

/**
 * A key record that cannot be read (SEC-6, TECH-7): logged at error by the field, never its value, and refused as
 * damaged, never as a wrong passphrase the person would type again and again.
 */
function damaged(field: string): { readonly refused: 'damaged' } {
  log.error('crypto.key_record_invalid', { field });
  return { refused: 'damaged' };
}

/** Base64 as Attest writes it: whole groups of four, padded. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const bytesOf = (text: string): Uint8Array<ArrayBuffer> | undefined =>
  BASE64.test(text) ? fromBase64(text) : undefined;

/** Whether `check` reads as a key check (src/crypto/seal.ts `keyCheck`): a nonce and a ciphertext with its tag. */
function isCheckText(check: string): boolean {
  const [iv, ct, ...rest] = check.split('.');
  const nonce = bytesOf(iv ?? '');
  const sealed = bytesOf(ct ?? '');
  return rest.length === 0 && nonce?.length === LEDGER_IV_BYTES && (sealed?.length ?? 0) > GCM_TAG_BYTES;
}

/**
 * The key `passphrase` gives under the ledger's salt, rounds and key id, when it opens the key check; a record that
 * cannot be read is damaged, told apart from a passphrase that does not give the key.
 */
async function keyFor(passphrase: string, state: CryptoState): Promise<Keyed> {
  const { salt, iterations, keyId, check } = state;
  if (keyId === undefined) return damaged('key_id');
  const saltBytes = bytesOf(salt ?? '');
  if (saltBytes?.length !== LEDGER_SALT_BYTES) return damaged('salt');
  if (iterations === undefined || iterations < MIN_KDF_ITERATIONS || iterations > MAX_KDF_ITERATIONS) {
    return damaged('iterations');
  }
  if (check === undefined || !isCheckText(check)) return damaged('check');
  const key = await deriveLedgerKey(passphrase, saltBytes, keyId, iterations);
  return opensCheck(key, check) ? { key } : { refused: 'wrong_passphrase' };
}

/** A new key from `passphrase`, with a new salt and id, and what `meta` keeps of it. */
async function newKey(passphrase: string) {
  const salt = newSalt();
  const key = await deriveLedgerKey(passphrase, salt, newKeyId(), LEDGER_KDF_ITERATIONS);
  const record = {
    keyId: key.id,
    salt: toBase64(salt),
    iterations: LEDGER_KDF_ITERATIONS,
    check: keyCheck(key),
  };
  return { key, record };
}

/** Turns encryption on: a key from the passphrase, every new row sealed, and the job that seals the rest. */
export function onCryptoEnable(message: CryptoEnableMessage, deps: CryptoDeps): Promise<CryptoResult> {
  return oneAtATime('crypto.enable', async () => {
    const db = await deps.db();
    const state = await readCryptoState(db);
    if (isGuarded(state)) return refused(state.job === undefined ? 'already_on' : 'busy');
    const { key, record } = await newKey(message.passphrase);
    await beginSealing(db, record);
    await hold({ current: key }, deps);
    log.info('crypto.enabled');
    void resumeCryptoJob(deps);
    return OK;
  });
}

/** Unlocks the ledger with its passphrase, and resumes a job a stop left under way. */
export function onCryptoUnlock(message: CryptoUnlockMessage, deps: CryptoDeps): Promise<CryptoResult> {
  return oneAtATime('crypto.unlock', async () => {
    const db = await deps.db();
    const state = await readCryptoState(db);
    if (!isGuarded(state)) return refused('off');
    const keyed = await keyFor(message.passphrase, state);
    if ('refused' in keyed) {
      if (keyed.refused === 'wrong_passphrase') log.info('crypto.unlock_refused');
      return refused(keyed.refused);
    }
    const { key } = keyed;
    const previous = state.previous === undefined ? undefined : unwrapKey(key, state.previous);
    // The key before, mid-change, that the right key does not open: refused whole, never half the ledger unlocked.
    if (state.previous !== undefined && previous === undefined) return refused(damaged('previous').refused);
    await hold({ current: key, ...(previous === undefined ? {} : { previous }) }, deps);
    log.info('crypto.unlocked');
    void resumeCryptoJob(deps);
    afterUnlock().catch((error: unknown) => {
      log.error('crypto.catch_up_failed', { error });
    });
    return OK;
  });
}

/**
 * Locks the ledger now: every context forgets the keys. A job under way pauses until the next unlock. Always, even
 * when this worker holds no key: the pages' copy goes too, as after a start whose clear failed (SEC-5).
 */
export function onCryptoLock(deps: CryptoDeps): Promise<CryptoResult> {
  return oneAtATime('crypto.lock', async () => {
    await hold({}, deps);
    log.info('crypto.locked');
    return OK;
  });
}

/** A new passphrase: a new key, the current one kept sealed under it, and the job that seals every row again. */
export function onCryptoChange(message: CryptoChangeMessage, deps: CryptoDeps): Promise<CryptoResult> {
  return oneAtATime('crypto.change', async () => {
    const db = await deps.db();
    const state = await readCryptoState(db);
    if (!state.on) return refused('off');
    if (state.job !== undefined) return refused('busy');
    const keyed = await keyFor(message.passphrase, state);
    if ('refused' in keyed) return refused(keyed.refused);
    const current = keyed.key;
    const { key, record } = await newKey(message.next);
    await beginResealing(db, record, wrapKey(key, current));
    await hold({ current: key, previous: current }, deps);
    log.info('crypto.changed');
    void resumeCryptoJob(deps);
    return OK;
  });
}

/** Turns encryption off: new rows plain, and the job that opens every sealed row for good. */
export function onCryptoDisable(message: CryptoDisableMessage, deps: CryptoDeps): Promise<CryptoResult> {
  return oneAtATime('crypto.disable', async () => {
    const db = await deps.db();
    const state = await readCryptoState(db);
    if (!state.on) return refused('off');
    if (state.job !== undefined) return refused('busy');
    const keyed = await keyFor(message.passphrase, state);
    if ('refused' in keyed) return refused(keyed.refused);
    await beginUnsealing(db);
    await hold({ current: keyed.key }, deps);
    log.info('crypto.disabling');
    void resumeCryptoJob(deps);
    return OK;
  });
}

/**
 * After the job: once off, every key goes; after a new passphrase, the key before goes. A job that sealed every row is
 * followed by the rebuild of the ledger's database (./rebuild.ts), so Chrome's files keep no older copy of a row.
 */
async function jobDone(done: CryptoJob, deps: CryptoDeps): Promise<void> {
  if (done === 'unseal') await hold({}, deps);
  else if (done === 'reseal') await hold(held.current === undefined ? {} : { current: held.current }, deps);
  else deps.notify(['meta']);
  log.info('crypto.job_done', { job: done });
  if (done !== 'unseal') await rebuildLedger(deps);
}

/** Runs the job under way, a step at a time, until it is done or the ledger is locked. */
async function runJob(deps: CryptoDeps): Promise<void> {
  const db = await deps.db();
  let table: string | undefined;
  for (;;) {
    if (isLocked()) return;
    const step = await stepCryptoJob(db);
    if (step === undefined) return;
    if (step.done) {
      // In its turn with the commands, so a lock or an unlock never lands in the middle of it (TECH-6).
      await oneAtATime('crypto.job_done', async () => {
        await jobDone(step.job, deps);
        return OK;
      });
      return;
    }
    if (step.table !== table) deps.notify(['meta']);
    table = step.table;
  }
}

/** Starts the job under way, if any and not already running; a lock pauses it, and the next unlock resumes it. */
export function resumeCryptoJob(deps: CryptoDeps): Promise<void> {
  job ??= runJob(deps)
    .catch((error: unknown) => {
      if (error instanceof LedgerError && error.code === 'locked') log.info('crypto.job_paused');
      else log.error('crypto.job_failed', { error });
    })
    .finally(() => {
      job = undefined;
    });
  return job;
}
