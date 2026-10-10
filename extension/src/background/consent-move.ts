/**
 * Moves an older profile's choices into the ledger (sprint_4 close, security review SEC-3). Before the close, which
 * readers were off and the feature flags were kept in `chrome.storage.local` (STORAGE_KEYS.READERS_OFF, a list of
 * readers; STORAGE_KEYS.FLAGS, a record of flags), where a content script can write. On an install or an update, the
 * service worker reads them once and writes each into ledger meta (src/ledger/consent.ts), then removes the old keys:
 *  - a list of readers: each turned off; anything else stored there: every reader off, as 4.5 read it, so a choice
 *    that cannot be read never turns a reader back on;
 *  - Check Gmail for me, when the record says true or false; nothing else is carried over, so every other flag, and a
 *    record that cannot be read, stays off.
 * Nothing stored: nothing to do. Logged with counts only.
 */
import { z } from 'zod';

import { READERS, STORAGE_KEYS } from '../config';
import { saveFlag, saveReaderOff } from '../ledger/consent';
import type { LedgerDb } from '../ledger/db';
import { log } from '../log';

/** The part of `chrome.storage.local` the move uses. */
export interface OldChoiceStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  remove(keys: string[]): Promise<void>;
}

const OldReadersOff = z.array(z.enum(READERS));
const OldFlags = z.object({ ATTEST_AUTO_CHECK_GMAIL: z.boolean().optional() });

/** Moves the stored choices, if any, into `db` (header). Resolves how many it moved. */
export async function moveStoredChoices(db: LedgerDb, storage: OldChoiceStorage): Promise<number> {
  const keys = [STORAGE_KEYS.READERS_OFF, STORAGE_KEYS.FLAGS];
  const stored = await storage.get(keys);
  const readers = stored[STORAGE_KEYS.READERS_OFF];
  const flags = stored[STORAGE_KEYS.FLAGS];
  if (readers === undefined && flags === undefined) return 0;
  let moved = 0;
  if (readers !== undefined) {
    const parsed = OldReadersOff.safeParse(readers);
    for (const reader of parsed.success ? parsed.data : READERS) {
      await saveReaderOff(db, reader, true);
      moved += 1;
    }
  }
  const autoCheck = OldFlags.safeParse(flags);
  if (autoCheck.success && autoCheck.data.ATTEST_AUTO_CHECK_GMAIL !== undefined) {
    await saveFlag(db, 'ATTEST_AUTO_CHECK_GMAIL', autoCheck.data.ATTEST_AUTO_CHECK_GMAIL);
    moved += 1;
  }
  await storage.remove(keys);
  log.info('consent.moved', { count: moved });
  return moved;
}
