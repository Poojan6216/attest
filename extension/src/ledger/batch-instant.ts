/**
 * The instant of the last grading batch, the `observedAt` a new claim or observation is stored with, and the instant
 * a user event (an override, a revert) is stamped with (docs/grading.md §3 Background obligations; Hard Rule 4).
 *
 * A batch grades the rows whose `observedAt ≤ evaluatedAt`, and replay rebuilds it from the stored rows with the
 * same filter. So no row may be stored with an `observedAt` at or before the instant of a batch that did not read
 * it, and a stored row's `observedAt` may never change once a batch could have read it. Three rules give that:
 *  - a batch records its `evaluatedAt` (`recordBatchInstant`) inside its readwrite transaction, before it reads
 *    anything, and each recorded instant is later than the last;
 *  - a new row is stamped where it is written, inside the readwrite transaction that writes it: its stored
 *    `observedAt` is the latest of its sighting, now (src/clock.ts) and the last batch instant + 1 ms
 *    (`stampObservedAt`);
 *  - a stored row is never rewritten (./upsert.ts): a later sighting changes nothing, an earlier one is refused.
 * Replay applies an override (or a revert) in exactly the batches evaluated after its instant, so the same holds for
 * user events: `writeUserEvent` stamps one inside the readwrite transaction (over `receipts` and `meta`) that writes
 * it, at the latest of now, the last batch instant + 1 ms and the receipt's own last event + 1 ms (`stampEventAt`,
 * `lastEventAt`), never before a batch that did not read it, even when the clock went back, and never before the
 * event it follows, which `transition` would refuse.
 */
import { z } from 'zod';

import { isoWithLocalOffset, nowIso } from '../clock';
import { readRow, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { epochMs } from './index-fields';
import { IsoTs, type Receipt } from './types';

/** The meta key holding the last batch's `evaluatedAt`. Written only by `recordBatchInstant`. */
export const LAST_EVALUATED_AT = 'lastEvaluatedAt';

/**
 * The meta key holding the ledger's stored-fact count (./clock-high-water.ts `STORED_WRITES`) as the last batch that
 * graded found it (tech review TECH-2). Written only by `noteGradedWrites`.
 */
export const GRADED_WRITES = 'gradedWrites';

const GradedWrites = z.strictObject({ key: z.literal(GRADED_WRITES), value: z.number().int().nonnegative() });

/** The stored-fact count the last batch that graded found, or undefined when none has been recorded. */
export async function gradedWrites(db: LedgerDb): Promise<number | undefined> {
  return readRow('meta', GradedWrites, await db.meta.get(GRADED_WRITES))?.value;
}

/** Records `writes`, the stored-fact count a batch graded with (call it in the batch's transaction). */
export async function noteGradedWrites(db: LedgerDb, writes: number): Promise<void> {
  await db.meta.put({ key: GRADED_WRITES, value: writes });
}

const LastEvaluatedAt = z.strictObject({ key: z.literal(LAST_EVALUATED_AT), value: IsoTs });

/**
 * The last recorded batch instant in epoch milliseconds, or `undefined` when no batch has been recorded. A stored
 * value that fails its schema reads as `undefined` (logged by id only, `ledger.row_invalid`) and the next
 * `recordBatchInstant` replaces it: refusing every write instead would stop all evidence from reaching the ledger,
 * and the "now" floor of `stampObservedAt` still holds meanwhile. Call it inside a transaction over `meta`.
 */
export async function lastBatchMs(db: LedgerDb): Promise<number | undefined> {
  const entry = readRow('meta', LastEvaluatedAt, await db.meta.get(LAST_EVALUATED_AT));
  return entry === undefined ? undefined : epochMs(entry.value);
}

/**
 * Records `evaluatedAt` as the last batch instant. The background calls it inside the batch's readwrite
 * transaction (whose scope includes `meta`), after stamping `evaluatedAt` and before reading any claim,
 * observation or receipt, so every row written after the call is stamped after `evaluatedAt` and the batch never
 * reads it. An instant at or before the last recorded one (two batches at one instant, or a clock that went back)
 * throws `batch_out_of_order` and writes nothing; a malformed one throws `invalid_input`.
 */
export async function recordBatchInstant(db: LedgerDb, evaluatedAt: string): Promise<void> {
  const parsed = IsoTs.safeParse(evaluatedAt);
  if (!parsed.success) {
    throw new LedgerError('invalid_input', 'evaluatedAt must be ISO 8601 with an offset', {
      table: 'meta',
      field: 'evaluatedAt',
    });
  }
  const atMs = epochMs(parsed.data);
  await db.transaction('rw', db.meta, async (): Promise<void> => {
    const last = await lastBatchMs(db);
    if (last !== undefined && atMs <= last) {
      throw new LedgerError(
        'batch_out_of_order',
        'A batch instant must be later than the last recorded one',
        {
          table: 'meta',
        },
      );
    }
    await db.meta.put({ key: LAST_EVALUATED_AT, value: parsed.data });
  });
}

/**
 * The `observedAt` a new row is stored with: its sighting when that is no earlier than now and later than the
 * last batch instant; otherwise the later of now and the last batch instant + 1 ms. `now` and `lastMs` are read
 * inside the readwrite transaction that writes the row. The sighting keeps its own spelling when it stands; the
 * last-batch floor is written with the local offset (src/clock.ts).
 */
export function stampObservedAt(sighted: IsoTs, now: IsoTs, lastMs: number | undefined): IsoTs {
  const nowMs = epochMs(now);
  const afterBatchMs = lastMs === undefined ? Number.NEGATIVE_INFINITY : lastMs + 1;
  if (epochMs(sighted) >= Math.max(nowMs, afterBatchMs)) return sighted;
  return nowMs >= afterBatchMs ? now : IsoTs.parse(isoWithLocalOffset(new Date(afterBatchMs)));
}

/**
 * The instant a user event is stamped with: now, unless the clock reads at or before the last batch instant or the
 * event's lower bound (`notBefore`, the receipt's own last event: `lastEventAt`); then 1 ms after the later of the
 * two (the floor `stampObservedAt` gives a row sighted now). `now` and `lastMs` are read inside the readwrite
 * transaction that writes the event (`writeUserEvent`).
 */
export function stampEventAt(now: IsoTs, lastMs: number | undefined, notBefore?: IsoTs): IsoTs {
  const boundMs =
    notBefore === undefined ? lastMs : Math.max(lastMs ?? Number.NEGATIVE_INFINITY, epochMs(notBefore));
  return stampObservedAt(now, now, boundMs);
}

/**
 * The instant of a receipt's own last event: the latest of its `computedAt` (its last grading), its override's
 * `at` and the `revertedAt` of each reverted override. `transition` refuses an override stamped before its
 * `computedAt` or its last `revertedAt`, and a revert stamped before its `override.at` (src/core/state.ts), so
 * this is the `notBefore` of the next event on it (`writeUserEvent`).
 */
export function lastEventAt(receipt: Receipt): IsoTs {
  let last = receipt.computedAt;
  const later = (at: IsoTs): void => {
    if (epochMs(at) > epochMs(last)) last = at;
  };
  if (receipt.override !== undefined) later(receipt.override.at);
  for (const { revertedAt } of receipt.reverted ?? []) later(revertedAt);
  return last;
}

/** What else bounds a user event's instant from below (`writeUserEvent`). */
export interface UserEventBound {
  /**
   * The receipt's own last event (`lastEventAt(receipt)`): the event is stamped at least 1 ms after it, so a clock
   * that went back below it cannot make `transition` refuse the event (`invalid_event`). ISO 8601 with an offset.
   */
  readonly notBefore?: string;
}

/**
 * Writes one user event (an override, or a revert, of a stored receipt; docs/grading.md §3, §8): runs `write(at)`
 * inside one readwrite transaction over `receipts` and `meta`, with `at` = `stampEventAt(now, last batch instant,
 * notBefore)` read inside it, and returns what `write` returns. `write` reads the receipt, applies the event with
 * `at` (src/core/state.ts `transition`) and stores it, inside the same transaction; it awaits only ledger
 * operations, because an IndexedDB transaction commits as soon as it waits on anything else. `notBefore` is the
 * receipt's `lastEventAt`, read from the receipt `write` changes: the caller reads it inside one readwrite
 * transaction over `receipts` and `meta` that also calls `writeUserEvent` (which then runs inside it), so no other
 * event on the receipt can land between the read and the write. A malformed `notBefore` throws
 * `LedgerError('invalid_input')` and writes nothing.
 *
 * Why (Hard Rule 4): replay applies an event in exactly the batches evaluated strictly after its instant. The
 * transaction runs before or after a batch's own (both write `meta`), never inside it. Written after, the event
 * reads that batch's recorded instant and is stamped after it, even when the clock went back, so a batch never
 * runs without an event replay puts in force for it. Written before, the batch reads it, and it is in force there
 * only if stamped before the batch's instant (§3). Called inside a transaction that lacks `receipts` or `meta`, or
 * is read-only, Dexie throws and nothing is written. The `notBefore` floor only ever moves the instant later, past
 * an event the receipt already holds, so the same holds for it: a revert or an override after the clock went back
 * below the receipt's own last event is stamped after that event and saved, instead of refused.
 */
export async function writeUserEvent<T>(
  db: LedgerDb,
  write: (at: IsoTs) => Promise<T>,
  bound: UserEventBound = {},
): Promise<T> {
  const notBefore = bound.notBefore === undefined ? undefined : IsoTs.safeParse(bound.notBefore);
  if (notBefore?.success === false) {
    throw new LedgerError('invalid_input', 'notBefore must be ISO 8601 with an offset', {
      table: 'receipts',
      field: 'notBefore',
    });
  }
  return db.transaction('rw', [db.receipts, db.meta], async (): Promise<T> => {
    const at = stampEventAt(IsoTs.parse(nowIso()), await lastBatchMs(db), notBefore?.data);
    return write(at);
  });
}
