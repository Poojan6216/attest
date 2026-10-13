/**
 * The ledger's keys in this context, in memory only (sprint_6 6.5): whether new rows are sealed, whether the ledger may
 * hold sealed rows at all, and the keys they open with: the current one while the ledger is unlocked, and during a
 * passphrase change the one before, until every row is sealed again. The service worker holds the keys a passphrase
 * unlocked in its own memory (src/background/crypto.ts), and mirrors them to `chrome.storage.session` for the
 * extension's pages (./session.ts) only while it runs: it clears that copy at every start, so a restart of the worker
 * forgets them and the ledger stays locked until the passphrase is typed again. Where each context takes its keys from
 * is src/ledger/shared.ts `setKeySource`. No key is ever written to disk. ./middleware.ts reads the keyring
 * synchronously, inside IndexedDB transactions.
 */
import type { LedgerKey } from './kdf';

/** The keys a context holds: none while the ledger is locked or encryption is off. */
export interface HeldKeys {
  /** The key rows are sealed with now. */
  readonly current?: LedgerKey;
  /** During a passphrase change, the key the rows not yet sealed again open with. */
  readonly previous?: LedgerKey;
}

export interface Keyring extends HeldKeys {
  /** Whether rows written now are sealed: encryption is on, and not being turned off. */
  readonly sealing: boolean;
  /** Whether the ledger may hold sealed rows: encryption is on, or a job turning it on or off has not finished. */
  readonly guarded: boolean;
}

const OPEN: Keyring = Object.freeze({ sealing: false, guarded: false });
let ring: Keyring = OPEN;

/** This context's keyring. */
export const keyring = (): Keyring => ring;

/** Replaces this context's keyring. */
export function setKeyring(next: Keyring): void {
  ring = next;
}

/** Forgets every key and flag in this context: a ledger without encryption, until the next load says otherwise. */
export function clearKeyring(): void {
  ring = OPEN;
}

const UNREAD: Keyring = Object.freeze({ sealing: true, guarded: true });

/**
 * Locks this context until its keyring is read again: while the ledger's state is being read, and after a read that
 * failed, so a context that cannot tell its keys are still good drops them (Sprint 6 close, security review SEC-5).
 */
export function lockKeyring(): void {
  ring = UNREAD;
}

/** The keys this context holds. */
export function heldKeys(): HeldKeys {
  return {
    ...(ring.current === undefined ? {} : { current: ring.current }),
    ...(ring.previous === undefined ? {} : { previous: ring.previous }),
  };
}

/** The key whose id is `id`, if this context holds it. */
export function keyWithId(id: string): LedgerKey | undefined {
  if (ring.current?.id === id) return ring.current;
  if (ring.previous?.id === id) return ring.previous;
  return undefined;
}

/** Whether the ledger is locked here: it may hold sealed rows, and no key to open them with is held. */
export const isLocked = (): boolean => ring.guarded && ring.current === undefined;
