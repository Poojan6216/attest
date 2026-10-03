/**
 * Idempotent writes of the two hash-keyed tables (observations on contentHash, claims on rawHash), for
 * ./repo.ts. One rw transaction per write, so concurrent upserts of one hash serialise.
 *
 * A hash seen again must be the same fact: only `observedAt` may differ, and the stored row keeps the earliest
 * `observedAt` of all its sightings, in whatever order they arrive (docs/grading.md §4.1; Hard Rule 5). A fact
 * that differs in anything else throws `LedgerError('id_conflict')` and changes nothing (Hard Rule 6). A stored
 * row no read can return is replaced, never treated as already stored.
 */
import type { Table } from 'dexie';
import type { z } from 'zod';

import { canonicalJson } from '../core/hash';
import { log } from '../log';
import { loggableId, logTableId, readRow, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { epochMs, type ClaimRow, type ObservationRow } from './index-fields';
import { Claim, Observation } from './types';

export interface UpsertResult {
  /** The stored row's id: the new one when inserted, the existing one when the hash was already known. */
  readonly id: string;
  readonly inserted: boolean;
}

/** A fact keyed on a unique hash, and the instant Attest first saw it. */
export interface Sighted {
  readonly id: string;
  readonly observedAt: string;
}

/** A table whose rows are idempotent on a unique hash. */
export interface HashedTable<Row, Fact extends Sighted> {
  readonly table: 'observations' | 'claims';
  readonly store: Table<Row, string>;
  readonly schema: z.ZodType<Fact>;
  readonly hashIndex: 'contentHash' | 'rawHash';
}

/** One write: the parsed fact, its unique hash, and the row (the fact plus index fields) that stores it. */
export interface Sighting<Row, Fact extends Sighted> {
  readonly hash: string;
  readonly fact: Fact;
  readonly row: Row;
}

/** Deletes a stored row that no read can return, so a valid write can take its place. */
async function dropUnreadable<Row, Fact extends Sighted>(
  target: HashedTable<Row, Fact>,
  id: string,
): Promise<void> {
  await target.store.delete(id);
  log.warn('ledger.row_replaced', { table: logTableId(target.table), id: loggableId(target.table, id) });
}

/**
 * The same hash seen again, inside the upsert's transaction. Only `observedAt` may differ: anything else means
 * the hash no longer names one fact (a re-read claim whose extractor changed, a planted row), so the write
 * throws `id_conflict` and the caller reports DEGRADED instead of losing the difference (Hard Rule 6; OBS-4).
 * An earlier `observedAt` replaces the stored one (§4.1: the earliest sighting is kept), so a pass that lands
 * late cannot make an event already on the calendar look newly "created" (Hard Rule 5; OBS-2).
 */
async function mergeSighting<Row, Fact extends Sighted>(
  target: HashedTable<Row, Fact>,
  stored: Fact,
  incoming: Sighting<Row, Fact>,
): Promise<void> {
  const unseen = (fact: Fact): string => canonicalJson({ ...fact, observedAt: undefined });
  if (unseen(stored) !== unseen(incoming.fact)) {
    throw new LedgerError('id_conflict', 'A different fact is already stored under this hash', {
      table: target.table,
      id: stored.id,
    });
  }
  if (isOlder(incoming.fact.observedAt, stored.observedAt)) await target.store.put(incoming.row);
}

/**
 * Inserts the sighting's row unless a readable row with the same unique hash exists, which it merges into
 * instead (`mergeSighting`). One rw transaction, so concurrent upserts of the same hash serialise: exactly one
 * inserts, the rest return its id, and the earliest `observedAt` among them is the one stored.
 *
 * A stored row that fails its schema is invisible to every read. If it held this hash (or this id), a
 * no-op would hide the new, valid fact forever: evidence Attest saw would never reach grading (Hard
 * Rule 5). So an unreadable row is replaced, never treated as "already stored".
 */
export async function insertUnlessHashExists<Row extends { readonly id: string }, Fact extends Sighted>(
  db: LedgerDb,
  target: HashedTable<Row, Fact>,
  incoming: Sighting<Row, Fact>,
): Promise<UpsertResult> {
  const { table, store, schema, hashIndex } = target;
  const { hash, row } = incoming;
  const readable = (stored: unknown): boolean => readRow(table, schema, stored) !== undefined;
  return db.transaction('rw', store, async (): Promise<UpsertResult> => {
    const [existingId] = await store.where(hashIndex).equals(hash).primaryKeys();
    if (existingId !== undefined) {
      const stored = readRow(table, schema, await store.get(existingId));
      if (stored !== undefined) {
        await mergeSighting(target, stored, incoming);
        return { id: existingId, inserted: false };
      }
      await dropUnreadable(target, existingId);
    }
    const sameId = await store.get(row.id);
    if (sameId !== undefined) {
      if (readable(sameId)) {
        throw new LedgerError('id_conflict', 'A row with this id already exists with a different hash', {
          table,
          id: row.id,
        });
      }
      await dropUnreadable(target, row.id);
    }
    await store.add(row);
    return { id: row.id, inserted: true };
  });
}

export function observationsByHash(db: LedgerDb): HashedTable<ObservationRow, Observation> {
  return { table: 'observations', store: db.observations, schema: Observation, hashIndex: 'contentHash' };
}

export function claimsByHash(db: LedgerDb): HashedTable<ClaimRow, Claim> {
  return { table: 'claims', store: db.claims, schema: Claim, hashIndex: 'rawHash' };
}

/** Whether `incomingTs` is an earlier instant than `storedTs` (offsets compared as instants). */
export function isOlder(incomingTs: string, storedTs: string): boolean {
  return epochMs(incomingTs) < epochMs(storedTs);
}
