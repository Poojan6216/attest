/**
 * The job that rewrites every row of the sealed tables (sprint_6 6.5): after encryption is turned on (each row sealed),
 * after a new passphrase (each row sealed again under the new key), and while it is turned off (each row opened for
 * good). One step is one transaction: up to SEAL_JOB_PAGE rows of the job's table, read through the sealing middleware
 * (so opened whole with whichever key sealed them) and put back (so sealed as the keyring says now: under the current
 * key, or plain while encryption is being turned off), with the job's place written beside them. A stop of the service
 * worker loses at most the step under way, and the next step starts where the last one ended (Hard Rule 6: nothing
 * half-done is left as done). A row that does not open fails the step whole, and the job stays where it was.
 */
import { Dexie } from 'dexie';

import { SEAL_JOB_PAGE, SEALED_TABLES } from '../config-crypto';
import { CRYPTO_KEYS, readCryptoState, type CryptoJob } from './crypto-state';
import { finishJob } from './crypto-writes';
import type { LedgerDb } from './db';
import { MetaEntry } from './types';

/** What one step did: rewrote rows in `table` and has more to do, or finished `job`. */
export type JobStep =
  { readonly done: false; readonly table: string } | { readonly done: true; readonly job: CryptoJob };

type RowKey = string | number | readonly (string | number)[];

const isRowKey = (value: unknown): value is RowKey =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  (Array.isArray(value) && value.every((part) => typeof part === 'string' || typeof part === 'number'));

/** The key the job's place names, or undefined at the start of a table (or for a place that does not parse). */
function placeOf(after: string | undefined): RowKey | undefined {
  if (after === undefined) return undefined;
  try {
    const key: unknown = JSON.parse(after);
    return isRowKey(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

/** One step of the job under way (header); undefined when no job is. */
export async function stepCryptoJob(db: LedgerDb): Promise<JobStep | undefined> {
  const { job, jobTable } = await readCryptoState(db);
  if (job === undefined) return undefined;
  const index = Math.max(0, SEALED_TABLES.indexOf(jobTable ?? ''));
  const name = SEALED_TABLES[index] ?? SEALED_TABLES[0] ?? 'requests';
  const table = db.table(name);
  return db.transaction('rw', [table, db.meta], async (): Promise<JobStep> => {
    const after = placeOf((await readCryptoState(db)).jobAfter);
    const page = after === undefined ? table.orderBy(':id') : table.where(':id').above(after);
    const rows: unknown[] = await page.limit(SEAL_JOB_PAGE).toArray();
    if (rows.length > 0) await table.bulkPut(rows);
    const last = rows.at(-1);
    if (rows.length === SEAL_JOB_PAGE && typeof last === 'object' && last !== null) {
      const key: unknown = Dexie.getByKeyPath(last, table.schema.primKey.keyPath ?? '');
      await db.meta.put(MetaEntry.parse({ key: CRYPTO_KEYS.JOB_AFTER, value: JSON.stringify(key) }));
      return { done: false, table: name };
    }
    const next = SEALED_TABLES[index + 1];
    if (next === undefined) {
      await finishJob(db, job);
      return { done: true, job };
    }
    await db.meta.delete(CRYPTO_KEYS.JOB_AFTER);
    await db.meta.put(MetaEntry.parse({ key: CRYPTO_KEYS.JOB_TABLE, value: next }));
    return { done: false, table: next };
  });
}
