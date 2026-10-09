/**
 * The extension's shared ledger instance, one per context (the service worker, each page). A module of its own, so a
 * page that only reads (src/ui/data.ts) opens the ledger without loading the repo's writers, the policy and the
 * retention code, all of which ran at the popup's start before (sprint_4 4.2: the popup paints in under 100 ms).
 * src/ledger/repo.ts re-exports both functions.
 */
import { Dexie } from 'dexie';

import { DB_NAME } from '../config';
import { log } from '../log';
import type { LedgerDb } from './db';
import { openLedger } from './migrations';

let shared: Promise<LedgerDb> | undefined;

/**
 * The extension's ledger (`DB_NAME`, latest migrations), opened once per context on first use.
 * A failed open is not cached: the next call retries.
 */
export function getLedger(): Promise<LedgerDb> {
  if (shared !== undefined) return shared;
  const opening = openLedger();
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
