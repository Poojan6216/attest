/**
 * The Receipt invariants (docs/grading.md §2, §3, §7, §8, §15), kept apart from ./schema-checks so each file
 * stays one readable page. Like it, this module imports nothing from ./schema, so the two never form an import
 * cycle; schema.ts runs `receiptProblems` in the Receipt's superRefine, and builds the `reverted` field with
 * `revertedOverrides` from its own primitives. PURE (Hard Rule 4).
 *
 *  - `override` iff USER_OVERRIDDEN, and `override.at ≥ computedAt`;
 *  - `finalAt` iff the state before any override is FINAL;
 *  - grade UNASKED iff `attribution: 'likely'` and no `claimId`; `attribution` and `supersededBy` on UNASKED only;
 *  - the lifecycle reasons: `override.user {grade: override.grade}` iff `override`, `superseded {claimId:
 *    supersededBy}` iff `supersededBy`, each once, after every graded reason, in §15 order;
 *  - the reverted overrides (`reverted`, oldest first; state.ts `revert` appends one): each was in force from its
 *    `at` to its `revertedAt` and is recorded with the computed part it sat beside (`previousState`, `computedAt`,
 *    `observationIds`), because batches graded other receipts under it while it was in force (batch-fixed.ts,
 *    Hard Rule 4). See `revertedProblems`.
 */
import { z } from 'zod';

import { instantMs, type Problem } from './schema-checks';

type State = 'PENDING' | 'FINAL' | 'USER_OVERRIDDEN';

/** The receipt fields the invariants read. `reasons` is read defensively: an invalid reason is reported elsewhere. */
export interface ReceiptFacts {
  readonly grade: string;
  readonly state: State;
  readonly claimId?: string | undefined;
  readonly attribution?: 'likely' | undefined;
  readonly override?:
    | {
        readonly grade: string;
        readonly at: string;
        readonly previousState: Exclude<State, 'USER_OVERRIDDEN'>;
      }
    | undefined;
  readonly supersededBy?: string | undefined;
  readonly reverted?: readonly RevertedFacts[] | undefined;
  readonly reasons: readonly unknown[];
  readonly computedAt: string;
  readonly finalAt?: string | undefined;
  readonly observationIds: readonly string[];
}

/** One reverted override as the invariants read it. */
export interface RevertedFacts {
  readonly at: string;
  readonly revertedAt: string;
  readonly previousState: Exclude<State, 'USER_OVERRIDDEN'>;
  readonly computedAt: string;
  readonly observationIds: readonly string[];
}

/** The caps a reverted override list is built with (schema.ts passes its SCHEMA_LIMITS). */
interface RevertedLimits {
  /** Observation ids on one receipt. */
  readonly BATCH: number;
  /** Reverted overrides on one receipt: as many as a receipt has reasons. */
  readonly REASONS: number;
}

/**
 * The Receipt's `reverted` field (§8), built from schema.ts's own primitives so this module never imports it: each
 * reverted override, oldest first, with the override's `grade` and `at`, the instant it was reverted, and the
 * computed part it sat beside (`previousState`, `computedAt`, `observationIds`). Never the override's reason: a
 * reverted override is a fact about batches, not text the user still asserts (Hard Rules 2, 10). Absent rather than
 * empty, so one receipt has one spelling.
 */
export function revertedOverrides<G extends z.ZodType, T extends z.ZodType, I extends z.ZodType>(
  grade: G,
  instant: T,
  id: I,
  limits: RevertedLimits,
) {
  const entry = z.strictObject({
    grade,
    at: instant,
    revertedAt: instant,
    previousState: z.enum(['PENDING', 'FINAL']),
    computedAt: instant,
    observationIds: z.array(id).max(limits.BATCH),
  });
  return z.array(entry).min(1).max(limits.REASONS);
}

/** `override` iff USER_OVERRIDDEN; `finalAt` iff the state before any override is FINAL (§3, §8). */
function stateProblems(receipt: ReceiptFacts): Problem[] {
  const problems: Problem[] = [];
  const overridden = receipt.state === 'USER_OVERRIDDEN';
  if (overridden && receipt.override === undefined) {
    problems.push(['override', 'required when state is USER_OVERRIDDEN']);
  }
  if (!overridden && receipt.override !== undefined) {
    problems.push(['override', 'allowed only when state is USER_OVERRIDDEN']);
  }
  const underlying = overridden ? receipt.override?.previousState : receipt.state;
  if (underlying === 'FINAL' && receipt.finalAt === undefined) {
    problems.push(['finalAt', 'required once the receipt is FINAL']);
  }
  if (underlying === 'PENDING' && receipt.finalAt !== undefined) {
    problems.push(['finalAt', 'a PENDING receipt has no finalAt']);
  }
  return problems;
}

/** grade UNASKED ⇔ attribution 'likely' and no claim; only UNASKED receipts are superseded (§2, §7, §8). */
function unaskedProblems(receipt: ReceiptFacts): Problem[] {
  const problems: Problem[] = [];
  if (receipt.grade === 'UNASKED') {
    if (receipt.attribution === undefined) problems.push(['attribution', "an UNASKED receipt says 'likely'"]);
    if (receipt.claimId !== undefined) problems.push(['claimId', 'an UNASKED receipt has no claim']);
    return problems;
  }
  if (receipt.attribution !== undefined) problems.push(['attribution', 'allowed only on an UNASKED receipt']);
  if (receipt.supersededBy !== undefined) {
    problems.push(['supersededBy', 'only an UNASKED receipt can be superseded']);
  }
  return problems;
}

/**
 * The lifecycle reasons (§8, §15): each is implied by one receipt field and carries that field's value as its one
 * param. In §15 table order, which is also the order they follow the graded reasons in.
 */
const LIFECYCLE: readonly {
  readonly code: string;
  readonly param: string;
  readonly field: string;
  readonly valueOf: (receipt: ReceiptFacts) => string | undefined;
}[] = [
  { code: 'override.user', param: 'grade', field: 'override', valueOf: (receipt) => receipt.override?.grade },
  { code: 'superseded', param: 'claimId', field: 'supersededBy', valueOf: (receipt) => receipt.supersededBy },
];

/** A reason's code, or undefined for a value that is not a reason (already reported at its own path). */
function codeOf(reason: unknown): unknown {
  return typeof reason === 'object' && reason !== null ? Reflect.get(reason, 'code') : undefined;
}

/** A reason's param `name`, or undefined when it is absent or the reason is malformed. */
function paramOf(reason: unknown, name: string): unknown {
  const params: unknown =
    typeof reason === 'object' && reason !== null ? Reflect.get(reason, 'params') : undefined;
  return typeof params === 'object' && params !== null ? Reflect.get(params, name) : undefined;
}

/** Whether every lifecycle reason follows every graded one, in table order (graded 0, then 1, 2, …). */
function lifecycleLast(reasons: readonly unknown[]): boolean {
  let rank = 0;
  for (const reason of reasons) {
    const next = LIFECYCLE.findIndex((lifecycle) => lifecycle.code === codeOf(reason)) + 1;
    if (next < rank) return false;
    rank = next;
  }
  return true;
}

/**
 * §8: `override.user {grade: override.grade}` is present iff `override` is, and `superseded {claimId:
 * supersededBy}` iff `supersededBy` is, each once, both after every graded reason in §15 order.
 */
function lifecycleProblems(receipt: ReceiptFacts): Problem[] {
  const { reasons } = receipt;
  if (!Array.isArray(reasons)) return [];
  const problems: Problem[] = [];
  for (const { code, param, field, valueOf } of LIFECYCLE) {
    const value = valueOf(receipt);
    const found = reasons.filter((reason) => codeOf(reason) === code);
    if (value === undefined) {
      if (found.length > 0) problems.push(['reasons', `${code} is allowed only with ${field}`]);
    } else if (found.length !== 1) {
      problems.push(['reasons', `${code} is required exactly once with ${field}`]);
    } else if (paramOf(found[0], param) !== value) {
      problems.push(['reasons', `${code} ${param} must equal ${field}`]);
    }
  }
  if (problems.length === 0 && !lifecycleLast(reasons)) {
    problems.push(['reasons', 'override.user and superseded come after every graded reason, in that order']);
  }
  return problems;
}

/** §8: a user overrides a receipt after it was computed, never before. */
function overrideProblems(receipt: ReceiptFacts): Problem[] {
  if (receipt.override === undefined) return [];
  // NaN (a field that is not an IsoTs, already reported at its own path) compares false: nothing to compare.
  return instantMs(receipt.override.at) < instantMs(receipt.computedAt)
    ? [[['override', 'at'], 'must not be before computedAt']]
    : [];
}

/** Whether two id lists are the same list. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Whether a batch evaluated at `ms` left the subject out because the reverted override `entry` was still in force
 * there (batch-fixed.ts `heldOutAt`, the one rule): a claim from the grading before the override to the revert,
 * `(computedAt, revertedAt]`; an orphan while the override took it, `(at, revertedAt]`.
 */
export function revertedHoldsAt(entry: RevertedFacts, claimless: boolean, ms: number): boolean {
  const from = instantMs(claimless ? entry.at : entry.computedAt);
  return from < ms && ms <= instantMs(entry.revertedAt);
}

/**
 * One entry on its own and against the one before it (§8): stamped in order, one override at a time, and a regrade
 * between them only once the earlier override no longer held the subject (`revertedHoldsAt`).
 */
function entryOrderProblems(
  entry: RevertedFacts,
  index: number,
  before: RevertedFacts | undefined,
  claimless: boolean,
): Problem[] {
  const problems: Problem[] = [];
  const at = (field: string): readonly string[] => ['reverted', String(index), field];
  const computedMs = instantMs(entry.computedAt);
  if (instantMs(entry.at) < computedMs) problems.push([at('at'), 'must not be before computedAt']);
  if (instantMs(entry.revertedAt) < instantMs(entry.at)) {
    problems.push([at('revertedAt'), 'must not be before at']);
  }
  if (before === undefined) return problems;
  if (instantMs(entry.at) < instantMs(before.revertedAt)) {
    problems.push([at('at'), 'must not be before the previous revertedAt']);
  }
  const beforeMs = instantMs(before.computedAt);
  if (computedMs < beforeMs) problems.push([at('computedAt'), 'must not be before the previous computedAt']);
  if (computedMs > beforeMs && revertedHoldsAt(before, claimless, computedMs)) {
    problems.push([at('computedAt'), 'must not be while the previous override was in force']);
  }
  return problems;
}

/**
 * One entry against the receipt it sits on (§8). The computed part it records is the receipt's own until a regrade
 * replaces it: while `computedAt` is unchanged, the same `previousState` (the state before any override) and
 * `observationIds`; once regraded, a PENDING one (a FINAL receipt is never regraded), regraded after the revert
 * (`revertedHoldsAt`), never before. A claim-less receipt's evidence never changes (its id names its observation).
 */
function entryReceiptProblems(entry: RevertedFacts, index: number, receipt: ReceiptFacts): Problem[] {
  const at = (field: string): readonly string[] => ['reverted', String(index), field];
  const [entryMs, receiptMs] = [instantMs(entry.computedAt), instantMs(receipt.computedAt)];
  const claimless = receipt.claimId === undefined;
  const problems: Problem[] = [];
  if (claimless && !sameIds(entry.observationIds, receipt.observationIds)) {
    problems.push([at('observationIds'), 'must equal observationIds on a claim-less receipt']);
  }
  if (entryMs > receiptMs) problems.push([at('computedAt'), 'must not be after computedAt']);
  if (entryMs === receiptMs) {
    const underlying = receipt.override?.previousState ?? receipt.state;
    if (entry.previousState !== underlying) {
      problems.push([at('previousState'), 'must be the state before any override until a regrade']);
    }
    if (!sameIds(entry.observationIds, receipt.observationIds)) {
      problems.push([at('observationIds'), 'must equal observationIds until a regrade']);
    }
  }
  if (entryMs < receiptMs && entry.previousState !== 'PENDING') {
    problems.push([at('previousState'), 'must be PENDING: a FINAL receipt is never regraded']);
  }
  if (entryMs < receiptMs && revertedHoldsAt(entry, claimless, receiptMs)) {
    problems.push([['computedAt'], 'must not be while a reverted override was in force']);
  }
  return problems;
}

/** §8: the reverted overrides in stamp order, before the override in force, each consistent with the receipt. */
function revertedProblems(receipt: ReceiptFacts): Problem[] {
  // Zod runs this refinement only once every field parsed, so `reverted` is a list of well-formed entries here.
  const { reverted } = receipt;
  if (reverted === undefined) return [];
  const problems = reverted.flatMap((entry, index) => [
    ...entryOrderProblems(entry, index, reverted[index - 1], receipt.claimId === undefined),
    ...entryReceiptProblems(entry, index, receipt),
  ]);
  const last = reverted.at(-1);
  if (receipt.override !== undefined && last !== undefined) {
    if (instantMs(receipt.override.at) < instantMs(last.revertedAt)) {
      problems.push([['override', 'at'], 'must not be before the last revertedAt']);
    }
  }
  return problems;
}

export function receiptProblems(receipt: ReceiptFacts): Problem[] {
  return [
    ...stateProblems(receipt),
    ...unaskedProblems(receipt),
    ...overrideProblems(receipt),
    ...lifecycleProblems(receipt),
    ...revertedProblems(receipt),
  ];
}
