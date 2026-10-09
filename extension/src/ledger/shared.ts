/**
 * The extension's shared ledger instance, one per context (the service worker, each page). A module of its own, so a
 * page that only reads (src/ui/data.ts) opens the ledger without loading the repo's writers, the policy and the
 * retention code, all of which ran at the popup's start before (sprint_4 4.2: the popup paints in under 100 ms).
 * src/ledger/repo.ts re-exports both functions.
 */
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
