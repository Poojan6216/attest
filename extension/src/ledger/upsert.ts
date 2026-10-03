/**
 * Idempotent writes of the two hash-keyed tables (observations on contentHash, claims on rawHash), for
 * ./repo.ts. One rw transaction per write over the table and `meta`, so concurrent upserts of one hash serialise,
 * and every write serialises with the batch that records its instant (./batch-instant.ts).
 *
 * A stored row is never rewritten: a batch may already have graded with it, and replay rebuilds that batch from
 * the stored row (docs/grading.md §3, §9; Hard Rule 4). So a hash seen again must be the same fact: only
 * `observedAt` may differ (and, for a claim, the `extractor` that read it). A fact that differs in anything else
 * throws `LedgerError('id_conflict')` and changes nothing (Hard Rule 6). An observation sighted at or after the
 * stored first sighting changes nothing; one sighted earlier throws `LedgerError('late_sighting')` and changes
 * nothing. A claim seen again changes nothing whenever it was sighted: nothing grades a claim's sighting (its
 * `observedAt` only decides which batches read it, §3), so an earlier one is no news. A new row is stored with the
 * `observedAt` `stampObservedAt` gives, read inside the transaction that writes it. When that is later than the
 * sighting, a new observation also keeps the sighting as `sightedAt` (§3, §4.1, §7: when it was first seen, which
 * `observedAt` no longer says); a claim does not. A stored row no read can return is replaced, never treated as
 * already stored.
 */
import type { Table } from 'dexie';
import type { z } from 'zod';

import { nowIso } from '../clock';
import { canonicalJson } from '../core/hash';
import { firstSeenAt } from '../core/order';
import { log } from '../log';
import { lastBatchMs, stampObservedAt } from './batch-instant';
import { loggableId, logTableId, readRow, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { epochMs, toClaimRow, toObservationRow, type ClaimRow, type ObservationRow } from './index-fields';
import { Claim, IsoTs, Observation } from './types';

export interface UpsertResult {
  /** The stored row's id: the new one when inserted, the existing one when the hash was already known. */
  readonly id: string;
  readonly inserted: boolean;
}

/** A fact keyed on a unique hash, and the instant Attest saw it. */
export interface Sighted {
  readonly id: string;
  readonly observedAt: IsoTs;
}

/** A table whose rows are idempotent on a unique hash. */
export interface HashedTable<Row, Fact extends Sighted> {
  readonly table: 'observations' | 'claims';
  readonly store: Table<Row, string>;
  readonly schema: z.ZodType<Fact>;
  readonly hashIndex: 'contentHash' | 'rawHash';
  /** The row that stores a fact: the fact plus its derived index fields. */
  readonly toRow: (fact: Fact) => Row;
  /** What two sightings of one fact share: the fact without the sighting (and without its provenance). */
  readonly identity: (fact: Fact) => string;
  /**
   * When a stored fact was first seen (an incoming one's sighting is its `observedAt`), for a table whose first
   * sighting grades (an observation: §4.1's `calendar.created` rule and the §7 anchor read it), so an earlier
   * sighting is refused. `undefined` for a table whose sighting grades nothing (a claim: its `observedAt` only
   * decides which batches read it, §3), so every sighting of a stored fact is a no-op.
   */
  readonly firstSeen: ((fact: Fact) => string) | undefined;
  /** The fact as stored when `stampObservedAt` gave `observedAt`, later than its sighting. */
  readonly stamped: (fact: Fact, observedAt: IsoTs) => Fact;
}

/** One write: the parsed fact and its unique hash. */
export interface Sighting<Fact extends Sighted> {
  readonly hash: string;
  readonly fact: Fact;
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
 * The same hash seen again, inside the upsert's transaction; the stored row is left exactly as it is. A fact that
 * differs in anything `identity` keeps throws `id_conflict` (a re-read whose extractor reads the claim
 * differently, a planted row: OBS-4), so the caller reports DEGRADED instead of losing the difference (Hard Rule
 * 6). Where the first sighting grades (`firstSeen`), a sighting earlier than the stored one throws
 * `late_sighting`: the ledger cannot move the stored instants, because a batch may have graded with them (Hard
 * Rule 4), and must not hide that they are later than an observer saw the fact (Hard Rules 5, 6). One at or after
 * it, and any sighting of a fact whose sighting grades nothing, tells the ledger nothing new.
 */
function assertSameSighting<Row, Fact extends Sighted>(
  target: HashedTable<Row, Fact>,
  stored: Fact,
  incoming: Fact,
): void {
  const context = { table: target.table, id: stored.id };
  if (target.identity(stored) !== target.identity(incoming)) {
    throw new LedgerError('id_conflict', 'A different fact is already stored under this hash', context);
  }
  const { firstSeen } = target;
  if (firstSeen !== undefined && isOlder(incoming.observedAt, firstSeen(stored))) {
    throw new LedgerError(
      'late_sighting',
      'A sighting earlier than the stored one arrived after it',
      context,
    );
  }
}

/** Frees the id for a new row: a readable row under it is a conflict, an unreadable one is dropped. */
async function freeId<Row, Fact extends Sighted>(target: HashedTable<Row, Fact>, id: string): Promise<void> {
  const sameId = await target.store.get(id);
  if (sameId === undefined) return;
  if (readRow(target.table, target.schema, sameId) !== undefined) {
    throw new LedgerError('id_conflict', 'A row with this id already exists with a different hash', {
      table: target.table,
      id,
    });
  }
  await dropUnreadable(target, id);
}

/**
 * Inserts the sighting's fact, stamped (`stampObservedAt`), unless a readable row with the same unique hash
 * exists, which it checks against instead (`assertSameSighting`). One rw transaction over the table and `meta`,
 * so concurrent upserts of the same hash serialise (exactly one inserts; the rest return its id or are refused),
 * and the stamp reads the last batch instant no batch can move until the write commits.
 *
 * A stored row that fails its schema is invisible to every read. If it held this hash (or this id), a no-op
 * would hide the new, valid fact forever: evidence Attest saw would never reach grading (Hard Rule 5). So an
 * unreadable row is replaced, never treated as "already stored".
 */
export async function insertUnlessHashExists<Row, Fact extends Sighted>(
  db: LedgerDb,
  target: HashedTable<Row, Fact>,
  incoming: Sighting<Fact>,
): Promise<UpsertResult> {
  const { table, store, schema, hashIndex } = target;
  const { hash, fact } = incoming;
  return db.transaction('rw', [store, db.meta], async (): Promise<UpsertResult> => {
    const [existingId] = await store.where(hashIndex).equals(hash).primaryKeys();
    if (existingId !== undefined) {
      const stored = readRow(table, schema, await store.get(existingId));
      if (stored !== undefined) {
        assertSameSighting(target, stored, fact);
        return { id: existingId, inserted: false };
      }
      await dropUnreadable(target, existingId);
    }
    await freeId(target, fact.id);
    const observedAt = stampObservedAt(fact.observedAt, IsoTs.parse(nowIso()), await lastBatchMs(db));
    await store.add(target.toRow(observedAt === fact.observedAt ? fact : target.stamped(fact, observedAt)));
    return { id: fact.id, inserted: true };
  });
}

export function observationsByHash(db: LedgerDb): HashedTable<ObservationRow, Observation> {
  return {
    table: 'observations',
    store: db.observations,
    schema: Observation,
    hashIndex: 'contentHash',
    toRow: toObservationRow,
    identity: (observation) => canonicalJson({ ...observation, observedAt: undefined, sightedAt: undefined }),
    firstSeen: firstSeenAt,
    stamped: (observation, observedAt) => ({ ...observation, observedAt, sightedAt: observation.observedAt }),
  };
}

/**
 * A claim's `extractor` is provenance, not content: a newer extractor version that reads a claim the same way
 * (same rawHash, same fields) re-reads the same claim. The stored row, its extractor included, is kept: a batch
 * may have graded with it, and the claim's hash in `inputsHash` covers the extractor (Hard Rule 4). A claim's
 * sighting grades nothing (§3: its `observedAt` only decides which batches read it; its own time is `claimedAt`),
 * so a re-read sighted before the stored `observedAt` is a no-op like any other (no `firstSeen`): refusing it
 * would turn the adapter DEGRADED for nothing (Hard Rule 6). A claim read before a batch but stored after it is
 * graded by the next batch, whichever read was stored first.
 */
export function claimsByHash(db: LedgerDb): HashedTable<ClaimRow, Claim> {
  return {
    table: 'claims',
    store: db.claims,
    schema: Claim,
    hashIndex: 'rawHash',
    toRow: toClaimRow,
    identity: (claim) => canonicalJson({ ...claim, observedAt: undefined, extractor: undefined }),
    firstSeen: undefined,
    stamped: (claim, observedAt) => ({ ...claim, observedAt }),
  };
}

/** Whether `incomingTs` is an earlier instant than `storedTs` (offsets compared as instants). */
export function isOlder(incomingTs: string, storedTs: string): boolean {
  return epochMs(incomingTs) < epochMs(storedTs);
}
