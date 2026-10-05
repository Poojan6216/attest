/**
 * Storing a Calendar pass's rows, all or none (docs/grading.md §3 `gcal.event` bullet and orphans, §7; Decisions
 * [2.7] wave D; Hard Rules 5, 7).
 *
 * A `gcal.event` row carries no account and no pass, so it must never stay stored without what the pass that first
 * saw it knew: a row kept from a refused pass, inside a span another view followed, would read as a change Attest saw
 * happen and could accuse an agent. So, for Calendar only (Gmail rows are still stored one by one, the 2.7
 * carry-forward):
 *  - every row of one pass is written inside one readwrite transaction (src/ledger/first-look.ts `inCalendarPass`),
 *    and the first refusal aborts it: nothing of the pass is stored, and the pass answers that refusal's code;
 *  - every first sighting (an event the pass could not compare with an earlier view) is written with its first-look
 *    marker (`upsertFirstSighting`), so it never accuses an agent, whatever windows its pass recorded;
 *  - a change (a creation, an update, a confirmed deletion) is written as it is: a view followed it.
 *
 * A page with no account (entrypoints/content/gcal.content.ts) posts its rows itself, every one a first sighting of
 * that pass (the page is compared with nothing): they are stored here, all or none, each with an account-less marker
 * (`storeAccountlessRows`), before the pass's pings, which are recorded only if the rows were (Hard Rule 5).
 */
import type { Policy } from '../core/policy';
import type { Observation } from '../core/schema';
import type { LedgerDb } from '../ledger/db';
import { inCalendarPass, type MarkerOwner, upsertFirstSighting } from '../ledger/first-look';
import { upsertObservation, type WriterClock } from '../ledger/repo';
import { rowCodeOf, type RowCode } from './row-codes';

/** One row of a Calendar pass, as `project()` built it, and whether it is a first sighting. */
export interface CalendarWrite {
  readonly observation: Observation;
  readonly firstSighting: boolean;
}

/** A row of a Calendar pass the ledger refused: thrown inside the pass's transaction, so it aborts all of it. */
export class CalendarRowRefused extends Error {
  override readonly name = 'CalendarRowRefused';

  constructor(readonly code: RowCode) {
    super(`A Calendar row was refused (${code})`);
  }
}

/**
 * Writes `writes` in order, inside the caller's pass transaction (`inCalendarPass`). A row the ledger refuses throws
 * `CalendarRowRefused` with its code (the transaction then aborts); any other error propagates as it is (a bug, such
 * as a policy `loadPolicy` did not return: Hard Rule 6). Returns how many rows were new. `clock` is the service
 * worker's: a stored row first seen after it was stamped before the clock went back, and an earlier re-sighting of
 * it changes nothing instead of refusing the pass (src/ledger/upsert.ts).
 */
export async function writeCalendarRows(
  db: LedgerDb,
  policy: Policy,
  writes: readonly CalendarWrite[],
  owner: MarkerOwner,
  clock: WriterClock,
): Promise<number> {
  let inserted = 0;
  for (const { observation, firstSighting } of writes) {
    try {
      const result = firstSighting
        ? await upsertFirstSighting(db, observation, policy, owner, clock)
        : await upsertObservation(db, observation, policy, clock);
      if (result.inserted) inserted += 1;
    } catch (error) {
      const code = rowCodeOf(error);
      if (code === undefined) throw error;
      throw new CalendarRowRefused(code);
    }
  }
  return inserted;
}

/** What storing a message's rows came to: how many were new, and the refusals (empty when all were stored). */
export interface StoredRows {
  readonly inserted: number;
  readonly codes: Set<RowCode>;
}

/**
 * The rows of a Calendar page with no account (see the header): each a first sighting, stored with an account-less
 * marker of `observerId`, all in one transaction, or none of them (the first refusal's code).
 */
export async function storeAccountlessRows(
  db: LedgerDb,
  policy: Policy,
  observerId: string,
  rows: readonly Observation[],
  clock: WriterClock,
): Promise<StoredRows> {
  const writes = rows.map((observation) => ({ observation, firstSighting: true }));
  const owner = { observerId };
  try {
    const inserted = await inCalendarPass(db, () => writeCalendarRows(db, policy, writes, owner, clock));
    return { inserted, codes: new Set() };
  } catch (error) {
    if (!(error instanceof CalendarRowRefused)) throw error;
    return { inserted: 0, codes: new Set([error.code]) };
  }
}
