/**
 * A person's override of a receipt's grade, and its revert (sprint_4 4.3; docs/grading.md §3 Background obligations,
 * §4.3, §8). The service worker applies them when the side panel asks (src/background/user-events.ts); pages never
 * write the ledger.
 *
 * Each event runs in one readwrite transaction over `receipts` and `meta`: it reads the receipt, then calls
 * `writeUserEvent` inside that transaction with `notBefore` = the receipt's own last event (`lastEventAt`), and in its
 * `write` applies the event through the state machine (src/core/state.ts `transition`) with the `at` it passes, and
 * stores the result. So the event is stamped at the latest of now, 1 ms after the last batch and 1 ms after the
 * receipt's own last event, inside the transaction that writes it: replay then applies it in exactly the batches
 * graded after it, whatever the clock did (SIM-1, R4-EVENT-ORDER). Nothing is ever stamped with `nowIso()` here.
 *
 * Refused, writing nothing:
 *  - `not_found`: the ledger holds no such receipt;
 *  - `refused`: the state machine refuses the event (an override of an overridden receipt, a revert of one not
 *    overridden, or a reason with no visible character);
 *  - `evidence_taken`: the revert of an override from FINAL to NOT_FOUND whose evidence another claim's receipt now
 *    holds. That override released the evidence, a later batch gave it to the other claim, and the revert would leave
 *    both receipts naming one observation (§4.3). The side panel says so.
 * The computed grade stays beside an override, and a revert keeps the override in `reverted`: replay shows an override,
 * never a grade change (§8).
 */
import { IllegalTransitionError, transition } from '../core/state';
import { lastEventAt, writeUserEvent } from './batch-instant';
import { readRow, readRows, type LedgerDb } from './db';
import { putReceipt } from './repo';
import { type IsoTs, type OverrideGrade, Receipt } from './types';

/** What a person does to a receipt: mark it with a grade of their own and why, or take that back. */
export type UserEvent =
  | { readonly kind: 'override'; readonly grade: OverrideGrade; readonly reason: string }
  | { readonly kind: 'revert' };

export type UserEventRefusal = 'not_found' | 'refused' | 'evidence_taken';

export type UserEventOutcome =
  | { readonly ok: true; readonly receipt: Receipt; readonly at: IsoTs }
  | { readonly ok: false; readonly code: UserEventRefusal };

/**
 * Whether a revert of `held` would leave its evidence named twice: its override took a FINAL claim receipt to NOT_FOUND
 * (releasing the evidence it held), and another claim's receipt now names one of its observations. Read through the
 * `*observationIds` index.
 */
async function evidenceTaken(db: LedgerDb, held: Receipt): Promise<boolean> {
  const { override, claimId, observationIds } = held;
  if (override?.grade !== 'NOT_FOUND' || override.previousState !== 'FINAL' || claimId === undefined)
    return false;
  if (observationIds.length === 0) return false;
  const naming = readRows(
    'receipts',
    Receipt,
    await db.receipts.where('observationIds').anyOf(observationIds).toArray(),
  );
  return naming.some(
    (other) => other.id !== held.id && other.claimId !== undefined && other.claimId !== claimId,
  );
}

/** Applies `event` to the receipt `id` (header), or says why it did not. */
export async function applyUserEvent(db: LedgerDb, id: string, event: UserEvent): Promise<UserEventOutcome> {
  return db.transaction('rw', [db.receipts, db.meta], async (): Promise<UserEventOutcome> => {
    const held = readRow('receipts', Receipt, await db.receipts.get(id));
    if (held === undefined) return { ok: false, code: 'not_found' };
    if (event.kind === 'revert' && (await evidenceTaken(db, held)))
      return { ok: false, code: 'evidence_taken' };
    const write = async (at: IsoTs): Promise<UserEventOutcome> => {
      let next: Receipt;
      try {
        next =
          event.kind === 'override'
            ? transition(held, { event: 'override', grade: event.grade, reason: event.reason, at })
            : transition(held, { event: 'revert', at });
      } catch (error) {
        if (error instanceof IllegalTransitionError) return { ok: false, code: 'refused' };
        throw error;
      }
      await putReceipt(db, next);
      return { ok: true, receipt: next, at };
    };
    return writeUserEvent(db, write, { notBefore: lastEventAt(held) });
  });
}
