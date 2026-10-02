/**
 * The typed error of batch grading (docs/grading.md §3, §4.3). Pure.
 */

export type BatchErrorCode =
  /** Two claims in one batch share an id: the ledger keys claims by id, so the batch is corrupt. */
  | 'duplicate_claim'
  /** A claim passed for grading is also a fixed pre-assignment: a FINAL claim is never regraded (§4.3, §8). */
  | 'claim_fixed'
  /** No grant of the agent is in force at `coverage.evaluatedAt`; core never invents one (Hard Rule 5). */
  | 'missing_grant'
  /** Two grants of one agent took effect at the same instant: which one is in force is undecidable. */
  | 'ambiguous_grant'
  /** Two receipts of one batch have the same id (a corrupt ledger: two observations, one id). */
  | 'duplicate_receipt';

/** Fail loud (Hard Rule 6): a batch that cannot be graded exactly is never graded approximately. */
export class BatchError extends Error {
  constructor(readonly code: BatchErrorCode) {
    super(`batch: ${code}`);
    this.name = 'BatchError';
  }
}
