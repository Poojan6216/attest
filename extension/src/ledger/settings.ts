/**
 * The settings the ledger keeps for the person (sprint_4 4.5, the options page's Privacy): the retention window, meta
 * `retentionDays`, one of `RETENTION_CHOICES` in days, and `RETENTION_DAYS` until the person chooses (and again after
 * Delete all data, which empties the ledger). The daily purge reads it in its own transaction (./retention-clock.ts),
 * so a window saved between two purges applies at the next one. Only the service worker writes it (`retention.save`);
 * the options page reads it (./views.ts), so this module imports no writer of the repo.
 */
import { z } from 'zod';

import { RETENTION_CHOICES, RETENTION_DAYS } from '../config';
import { readRow, type LedgerDb } from './db';

/** The meta key of the retention window. Written only by `saveRetentionDays`. */
export const RETENTION_DAYS_KEY = 'retentionDays';

export type RetentionChoice = (typeof RETENTION_CHOICES)[number];

const RetentionEntry = z.strictObject({
  key: z.literal(RETENTION_DAYS_KEY),
  value: z.literal(RETENTION_CHOICES),
});

/**
 * The retention window in force: the one saved, or `RETENTION_DAYS`. A stored value that is not one of the choices
 * reads as the default (logged by key, `ledger.row_invalid`), never as a shorter window.
 */
export async function readRetentionDays(db: LedgerDb): Promise<RetentionChoice> {
  return readRow('meta', RetentionEntry, await db.meta.get(RETENTION_DAYS_KEY))?.value ?? RETENTION_DAYS;
}

/** Saves the retention window (a value that is not one of the choices is refused by its schema). */
export async function saveRetentionDays(db: LedgerDb, days: RetentionChoice): Promise<void> {
  await db.meta.put(RetentionEntry.parse({ key: RETENTION_DAYS_KEY, value: days }));
}
