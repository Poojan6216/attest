/**
 * Reading one `meta` value (the ledger's small settings and markers), in a module of its own so a page or the
 * keyring's loader (./crypto-state.ts) reads one without loading the repo's writers. ./repo.ts re-exports it.
 */
import { type LedgerDb, readRow } from './db';
import { MetaEntry } from './types';

/** The value stored under `key`, or undefined when none is, or the stored row fails its schema. */
export async function getMeta(db: LedgerDb, key: string): Promise<MetaEntry['value'] | undefined> {
  return readRow('meta', MetaEntry, await db.meta.get(key))?.value;
}
