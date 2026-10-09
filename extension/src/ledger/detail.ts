/**
 * A receipt's detail (sprint_4 4.0, 4.3; src/ui/data.ts `loadReceipt`): the receipt, its claim and request, its
 * evidence in the receipt's order, and what grading saw (its replay inputs, the batch's coverage joined), each read by
 * key in one read transaction, never recomputed. A module of its own, which the side panel loads when it opens a
 * receipt, so the popup's start never loads the replay records' code (./views.ts).
 */
import { readRow, readRows, type LedgerDb } from './db';
import { receiptInputsOf } from './replay-records';
import { Claim, Observation, Receipt, type ReceiptInputs, Request } from './types';

/** A receipt and everything that explains it, as stored: never recomputed. */
export interface ReceiptDetail {
  readonly receipt: Receipt;
  readonly claim: Claim | undefined;
  readonly request: Request | undefined;
  /** The evidence the receipt names, in its order; one the purge removed is missing. */
  readonly observations: readonly Observation[];
  /** What grading saw (the batch's coverage, the grant, the context, the policy's hash), when the ledger holds it. */
  readonly inputs: ReceiptInputs | undefined;
}

/** One receipt's detail (header), or undefined when the ledger holds no such receipt. */
export async function receiptDetail(db: LedgerDb, id: string): Promise<ReceiptDetail | undefined> {
  const tables = [db.receipts, db.claims, db.requests, db.observations, db.receiptInputs, db.batchCoverages];
  return db.transaction('r', tables, async () => {
    const receipt = readRow('receipts', Receipt, await db.receipts.get(id));
    if (receipt === undefined) return undefined;
    const evidence = await db.observations.bulkGet([...receipt.observationIds]);
    return {
      receipt,
      claim:
        receipt.claimId === undefined
          ? undefined
          : readRow('claims', Claim, await db.claims.get(receipt.claimId)),
      request:
        receipt.requestId === undefined
          ? undefined
          : readRow('requests', Request, await db.requests.get(receipt.requestId)),
      observations: readRows('observations', Observation, evidence),
      inputs: await receiptInputsOf(db, receipt.inputsHash),
    };
  });
}
