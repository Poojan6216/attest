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
 *
 * The ledger is in the storage bucket `chrome.storage.local` names (./place.ts). While the service worker rebuilds it
 * into the next bucket (Sprint 6 close, security review SEC-1; ./rebuild.ts), every `getLedger()` waits: in the worker,
 * until its rebuild releases the hold it took (`holdLedger`); in a page, while the session's mark is set
 * (./rebuild-mark.ts), the page's own connection closed so it opens the bucket named after. So nothing writes rows the
 * copy has passed, and nothing reads a bucket about to be deleted. A connection Chrome closes, as it does when it
 * deletes the bucket, is forgotten: the next `getLedger()` opens the bucket named then.
 */
import { Dexie } from 'dexie';

import { DB_NAME } from '../config';
import { log } from '../log';
import { lockKeyring, type HeldKeys } from '../crypto/keyring';
import { onSessionKeysChanged, readSessionKeys } from '../crypto/session';
import { loadKeyring } from './crypto-state';
import type { LedgerDb } from './db';
import { MIGRATIONS, openLedger } from './migrations';
import { bucketIndexedDb, deleteLedgerBucket, ledgerBucket, ledgerBuckets } from './place';
import { onRebuildMarkChanged, readRebuildMark } from './rebuild-mark';

/** Where this context's ledger keys come from (header). */
export type KeySource = () => Promise<HeldKeys>;

let shared: Promise<LedgerDb> | undefined;
let keySource: KeySource = readSessionKeys;
let watching = false;
let reloading: Promise<void> = Promise.resolve();
const reloaded = new Set<() => void>();
/** What every `getLedger()` waits for: open, unless a rebuild holds it (header). */
let gate: Promise<void> = Promise.resolve();
/** Whether this context follows the session's rebuild mark: every page; never the service worker, which sets it. */
let followsMark = true;
let markFollowed: Promise<void> | undefined;
let releaseMarkHold: (() => void) | undefined;

/** Holds every `getLedger()` of this context from now until the release it returns is called (header). */
export function holdLedger(): () => void {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  gate = gate.then(() => held);
  return release;
}

/** The service worker's start: it sets the rebuild mark itself, so it never waits on it. */
export function ignoreRebuildMark(): void {
  followsMark = false;
}

/** A page: the mark set holds its reads and closes its connection; the mark removed lets them go. */
function onRebuildMark(on: boolean): void {
  if (on && releaseMarkHold === undefined) {
    releaseMarkHold = holdLedger();
    void closeLedger();
  } else if (!on && releaseMarkHold !== undefined) {
    releaseMarkHold();
    releaseMarkHold = undefined;
  }
}

/** A page: reads the session's rebuild mark once, then follows each change of it (header). */
function followRebuildMark(): Promise<void> {
  if (!followsMark) return Promise.resolve();
  markFollowed ??= (async () => {
    let changed: boolean | undefined;
    onRebuildMarkChanged((on) => {
      changed = on;
      onRebuildMark(on);
    });
    const on = await readRebuildMark();
    // A change seen while the mark was being read is newer than what the read returned.
    onRebuildMark(changed ?? on);
  })().catch((error: unknown) => {
    log.warn('ledger.rebuild_mark_unread', { error });
  });
  return markFollowed;
}

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
    })
    .catch((error: unknown) => {
      // Fail closed (Sprint 6 close, security review SEC-5): keys this context cannot vouch for any more are dropped.
      lockKeyring();
      log.warn('ledger.keyring_reload_failed', { error });
    })
    .finally(() => {
      for (const listener of reloaded) listener();
    });
  return reloading;
}

async function openWithKeys(): Promise<LedgerDb> {
  const db = await openLedger(DB_NAME, MIGRATIONS, {
    indexedDB: await bucketIndexedDb(await ledgerBucket()),
  });
  await loadKeyring(db, () => keySource());
  if (!watching) {
    watching = true;
    onSessionKeysChanged(() => {
      void reloadKeyring();
    });
  }
  return db;
}

function ledgerNow(): Promise<LedgerDb> {
  if (shared !== undefined) return shared;
  const opening = openWithKeys();
  shared = opening;
  opening.then(
    (db) => {
      // Closed by Chrome (its bucket deleted) or here: forgotten, so the next read opens the bucket named then (header).
      db.on('close', () => {
        if (shared === opening) shared = undefined;
      });
    },
    (error: unknown) => {
      if (shared === opening) shared = undefined;
      log.warn('ledger.shared_open_reset', { error });
    },
  );
  return opening;
}

/**
 * The extension's ledger (`DB_NAME`, latest migrations, in the bucket named), opened once per context on first use,
 * with its keyring loaded, once no rebuild holds it (header). A failed open is not cached: the next call retries.
 */
export function getLedger(): Promise<LedgerDb> {
  return followRebuildMark()
    .then(() => gate)
    .then(ledgerNow);
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
 * Deletes the ledger (sprint_4 4.5, Delete all data): closes this context's instance, then deletes every ledger bucket,
 * each with the folder of Chrome's files that held it (./place.ts), and a ledger a build before buckets kept in the
 * default store (./rebuild.ts `settleLedgerPlace`). Chrome closes a page's connection as it deletes the bucket; the page
 * opens the bucket named at its next read. The next `getLedger()` here opens a new, empty ledger.
 */
export async function deleteLedger(): Promise<void> {
  await closeLedger();
  for (const bucket of await ledgerBuckets()) await deleteLedgerBucket(bucket);
  await Dexie.delete(DB_NAME);
}
