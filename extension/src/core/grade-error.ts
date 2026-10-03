/**
 * The typed error of conditions.ts, receipt.ts and grade.ts (docs/grading.md §3, §8, §15). A leaf module: it
 * imports nothing, so every grading module can throw it without an import cycle (§13 order).
 *
 * Each code names an input `grade()` refuses to guess about (Hard Rule 6: fail loud). Messages carry the code
 * only, never a value (Hard Rule 10).
 */

export type GradeErrorCode =
  /** The grant is not the claim's agent's, or a claim-less attribution names another agent than the grant. */
  | 'agent_mismatch'
  /**
   * A claim-less grade needs exactly one subject (§3): one orphan observation (UNASKED) or `context.scope` (a
   * scope-diff receipt), never both, never neither, never two orphans; an UNASKED outcome needs the orphan.
   */
  | 'claimless_subject'
  /** A policy rule concluded UNASKED for a claim: an UNASKED receipt has no claim (§8 receipt invariants). */
  | 'unasked_with_claim'
  /**
   * A claim's candidate that `candidates()` could never have returned for it (§4.1): another type, a source the
   * policy does not list for the claim's type, an `occurredAt` outside the claim window (any candidate of a
   * calendar claim without `targetAt`), or a `calendar.created` event first seen before the claim's bound
   * (grade-guard.ts). Grading it would turn a caller's bug into a FINAL receipt (Hard Rules 5, 6).
   */
  | 'foreign_candidate'
  /** A reason code the core schema does not know yet (the schema is older than the contract). */
  | 'unknown_reason_code';

export class GradeError extends Error {
  constructor(readonly code: GradeErrorCode) {
    super(`grade: ${code}`);
    this.name = 'GradeError';
  }
}
