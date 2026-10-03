/**
 * The typed error of a broken internal invariant in src/core: a guard against programmer error that no input
 * reaches (a batch table asked for a row it does not hold, a SHA-256 writer written after its digest). A leaf module:
 * it imports nothing, so the lowest modules (sha256.ts) can throw it without an import cycle (docs/grading.md §13).
 *
 * Fail loud (Hard Rule 6) with a closed code, like every other core error, so replay's report names it
 * (`InvariantError:<code>`). Messages carry the code only, never a value (Hard Rule 10).
 */

export type InvariantErrorCode =
  /** A batch's candidate table was asked for a row index it does not hold (batch-table.ts). */
  | 'no_such_row'
  /** A SHA-256 writer was written to after its digest was read (sha256.ts). */
  | 'write_after_digest';

export class InvariantError extends Error {
  constructor(readonly code: InvariantErrorCode) {
    super(`core invariant: ${code}`);
    this.name = 'InvariantError';
  }
}
