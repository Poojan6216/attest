/**
 * The typed error of candidate retrieval and assignment (docs/grading.md §4). Pure.
 */

export type CandidatesErrorCode =
  /** `createMemoryIndex` with a bucket width that is not a positive whole number of minutes. */
  | 'invalid_bucket'
  /** An index read with a bound that is not a safe integer of epoch milliseconds. */
  | 'invalid_range'
  /** Fixed pre-assignments that give one observation two claims or one claim two observations (§4.3). */
  | 'fixed_conflict'
  /** A scored pair whose `claimedAtMs` is not a safe integer (ties compare instants exactly, §4.3). */
  | 'invalid_pair';

/** Fail loud (Hard Rule 6): a broken index or a corrupt pre-assignment never grades silently. */
export class CandidatesError extends Error {
  constructor(readonly code: CandidatesErrorCode) {
    super(`candidates: ${code}`);
    this.name = 'CandidatesError';
  }
}
