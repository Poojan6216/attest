/**
 * The instant of the last grading batch, and the `observedAt` a new claim or observation is stored with
 * (docs/grading.md §3 Background obligations; Hard Rule 4).
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
 */
import { z } from 'zod';

import { isoWithLocalOffset } from '../clock';
import { readRow, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { epochMs } from './index-fields';
import { IsoTs } from './types';

/** The meta key holding the last batch's `evaluatedAt`. Written only by `recordBatchInstant`. */
export const LAST_EVALUATED_AT = 'lastEvaluatedAt';

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
