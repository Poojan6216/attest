/**
 * How a batch's receipts replace the stored ones (docs/grading.md §3, §7, §8, §9): the one rule the background stores
 * every batch by (src/background/grading.ts) and the replay simulator plays (tests/tools/attest-ledger.ts), so the
 * live ledger and the one replay is tested against never differ.
 *
 * `storeBatch` takes the stored receipts and what `gradeBatch` returned:
 *  - a new subject's receipt is inserted; a PENDING row is replaced through state.ts `regrade`;
 *  - a FINAL, overridden or superseded row is kept and the regrade discarded (UNASKED and scope receipts, §3);
 *  - a PENDING claim-less row the batch no longer produces is deleted (§7), unless it holds reverted overrides: the
 *    batches that ran while one was in force had its orphan taken, which replay must still see (§8, §9);
 *  - every receipt written is stored with its inputs ({coverage, grant, context, policyHash}) under its `inputsHash`,
 *    and the inputs of a row replaced or deleted go once no receipt names them (§9).
 * `supersede` then marks the UNASKED receipt of every observation a FINAL claim receipt holds as superseded by that
 * claim (§7, §8: a claim that later explained an unclaimed action).
 *
 * PURE: no I/O, no clock (Hard Rule 4).
 */
import type { BatchReceipt } from './batch-grade';
import { receiptId } from './receipt';
import type { ReceiptInputs } from './replay';
import type { Coverage, Receipt, Ulid } from './schema';
import { transition } from './state';

/** What a batch changes in the stored receipts and their inputs. */
export interface StoredBatch {
  /** Receipts to write: new subjects and regraded PENDING rows, in the batch's order (receipt id). */
  readonly put: readonly Receipt[];
  /** Ids of the PENDING claim-less rows the batch no longer produces. */
  readonly deleted: readonly Ulid[];
  /**
   * Ids of the PENDING claim-less rows the batch no longer produces and keeps, since they hold reverted overrides: rows
   * no batch grades again until a new fact makes one produce them (sprint_4 close, tech review TECH-7).
   */
  readonly held: readonly Ulid[];
  /** The inputs of every receipt written, by its `inputsHash`. */
  readonly inputs: ReadonlyMap<string, ReceiptInputs>;
  /** The `inputsHash` of each row replaced or deleted that no receipt names any more. */
  readonly released: readonly string[];
}

/** Stores one batch's output over `stored` (the rules in the file comment); `coverage` is the batch's own. */
export function storeBatch(
  stored: ReadonlyMap<Ulid, Receipt>,
  graded: readonly BatchReceipt[],
  coverage: Coverage,
): StoredBatch {
  const put: Receipt[] = [];
  const inputs = new Map<string, ReceiptInputs>();
  const produced = new Set<Ulid>();
  const gone: Receipt[] = [];
  for (const { receipt, inputs: own } of graded) {
    produced.add(receipt.id);
    const held = stored.get(receipt.id);
    if (held !== undefined && (held.state !== 'PENDING' || held.supersededBy !== undefined)) continue;
    put.push(held === undefined ? receipt : transition(held, { event: 'regrade', next: receipt }));
    inputs.set(receipt.inputsHash, { coverage, ...own });
    if (held !== undefined) gone.push(held);
  }
  const deleted: Ulid[] = [];
  const held: Ulid[] = [];
  for (const [id, receipt] of stored) {
    if (receipt.claimId !== undefined || receipt.state !== 'PENDING' || produced.has(id)) continue;
    if (receipt.reverted !== undefined) {
      held.push(id);
      continue;
    }
    deleted.push(id);
    gone.push(receipt);
  }
  const written = new Set(put.map(({ id }) => id));
  const named = new Set(put.map(({ inputsHash }) => inputsHash));
  for (const [id, receipt] of stored) {
    if (!written.has(id) && !deleted.includes(id)) named.add(receipt.inputsHash);
  }
  const released = [...new Set(gone.map(({ inputsHash }) => inputsHash))].filter((hash) => !named.has(hash));
  return { put, deleted, held, inputs, released };
}

/**
 * The UNASKED receipts the FINAL claim receipts among `receipts` supersede (§7, §8), each with `supersededBy` set:
 * the rows to write. A FINAL claim receipt holds the observation it names first; its UNASKED receipt, if any and not
 * already superseded by that claim, is superseded.
 */
export function supersede(receipts: ReadonlyMap<Ulid, Receipt>): Receipt[] {
  const current = new Map(receipts);
  const changed = new Map<Ulid, Receipt>();
  for (const receipt of receipts.values()) {
    const [held] = receipt.observationIds;
    if (receipt.claimId === undefined || receipt.state !== 'FINAL' || held === undefined) continue;
    const unaskedId = receiptId({ k: 'unasked', observationId: held });
    const unasked = current.get(unaskedId);
    if (unasked === undefined || unasked.supersededBy === receipt.claimId) continue;
    const next = transition(unasked, { event: 'supersede', claimId: receipt.claimId });
    current.set(unaskedId, next);
    changed.set(unaskedId, next);
  }
  return [...changed.values()];
}
