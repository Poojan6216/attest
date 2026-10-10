/**
 * The service worker while the ledger is encrypted and locked (sprint_6 6.5): it stores nothing an observer sends, its
 * coverage least of all, so no window counts as read while its rows could not be kept (Hard Rule 5: a claim in it
 * stays UNVERIFIABLE, never NOT_FOUND); a pasted import is refused the same way; and the alarms that read or write the
 * sealed tables wait for the unlock (./alarms.ts). The keyring is loaded with the ledger, so the ledger is opened first.
 */
import { isLocked } from '../crypto/keyring';
import type { LedgerDb } from '../ledger/db';

/** Whether the ledger is locked in this worker. */
export async function ledgerLocked(db: () => Promise<LedgerDb>): Promise<boolean> {
  await db();
  return isLocked();
}

/** The refusal while the ledger is locked. */
export interface LockedRefusal {
  readonly ok: false;
  readonly code: 'locked';
}

/** `locked` while the ledger is locked (an ack, or an import's answer); undefined otherwise, for the handler to go on. */
export async function lockedAck(db: () => Promise<LedgerDb>): Promise<LockedRefusal | undefined> {
  return (await ledgerLocked(db)) ? { ok: false, code: 'locked' } : undefined;
}
