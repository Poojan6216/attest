/**
 * The extension's shared ledger instance, one per context (the service worker, each page). A module of its own, so a
 * page that only reads (src/ui/data.ts) opens the ledger without loading the repo's writers, the policy and the
 * retention code, all of which ran at the popup's start before (sprint_4 4.2: the popup paints in under 100 ms).
 * src/ledger/repo.ts re-exports both functions.
 *
 * The keyring (sprint_6 6.5; src/crypto/keyring.ts) is loaded before anything reads the ledger, and again whenever the
 * session's keys change: unlocked, locked, a new passphrase, encryption turned off. Its keys come from `setKeySource`:
 * an extension page reads the copy the service worker keeps for the pages in `chrome.storage.session`; the service
 * worker sets its own memory as its source at its start (src/background/crypto.ts), so it never takes a key it did
 * not unlock itself.
 */
import { Dexie } from 'dexie';

import { DB_NAME } from '../config';
import { log } from '../log';
import type { HeldKeys } from '../crypto/keyring';
import { onSessionKeysChanged, readSessionKeys } from '../crypto/session';
import { loadKeyring } from './crypto-state';
import type { LedgerDb } from './db';
import { openLedger } from './migrations';

/** Where this context's ledger keys come from (header). */
export type KeySource = () => Promise<HeldKeys>;

let shared: Promise<LedgerDb> | undefined;
let keySource: KeySource = readSessionKeys;
let watching = false;
let reloading: Promise<void> = Promise.resolve();
const reloaded = new Set<() => void>();

/** Calls `listener` after each reload of this context's keyring (the keys changed), so a page reads again; returns the stop. */
export function onKeyringReloaded(listener: () => void): () => void {
  reloaded.add(listener);
  return () => {
    reloaded.delete(listener);
  };
}

/** Sets where this context's ledger keys come from (header); the service worker's start calls it first. */
export function setKeySource(source: KeySource): void {
  keySource = source;
}

/**
 * Reloads this context's keyring from the ledger open now, if one is, after any reload before it: one at a time, so
 * the last change of the session's keys is the last one read (a quick unlock and lock never ends unlocked).
 */
export function reloadKeyring(): Promise<void> {
  const current = shared;
  if (current === undefined) return reloading;
  reloading = reloading
    .then(async () => {
      await loadKeyring(await current, () => keySource());
      for (const listener of reloaded) listener();
    })
    .catch((error: unknown) => {
      log.warn('ledger.keyring_reload_failed', { error });
    });
  return reloading;
}

async function openWithKeys(): Promise<LedgerDb> {
  const db = await openLedger();
  await loadKeyring(db, () => keySource());
  if (!watching) {
    watching = true;
    onSessionKeysChanged(() => {
      void reloadKeyring();
    });
  }
  return db;
}

/**
 * The extension's ledger (`DB_NAME`, latest migrations), opened once per context on first use, with its keyring
 * loaded. A failed open is not cached: the next call retries.
 */
export function getLedger(): Promise<LedgerDb> {
  if (shared !== undefined) return shared;
  const opening = openWithKeys();
  shared = opening;
  opening.catch((error: unknown) => {
    if (shared === opening) shared = undefined;
    log.warn('ledger.shared_open_reset', { error });
  });
  return opening;
}

/** Closes the shared instance (if any) and forgets it; the next `getLedger()` reopens. */
export async function closeLedger(): Promise<void> {
  const current = shared;
  shared = undefined;
  if (current === undefined) return;
  try {
    (await current).close();
  } catch (error) {
    log.warn('ledger.close_skipped', { error });
  }
}

/**
 * Deletes the ledger's database (sprint_4 4.5, Delete all data): closes this context's instance, then deletes the
 * database once every other connection closed (Dexie closes a page's when Chrome asks it to; that page opens a new,
 * empty one at its next read, after the delete). The next `getLedger()` here opens a new, empty ledger.
 */
export async function deleteLedger(): Promise<void> {
  await closeLedger();
  await Dexie.delete(DB_NAME);
}
