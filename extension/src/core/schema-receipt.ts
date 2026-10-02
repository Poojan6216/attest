/**
 * The Receipt invariants (docs/grading.md §2, §3, §7, §8, §15), kept apart from ./schema-checks so each file
 * stays one readable page. Like it, this module imports nothing from ./schema, so the two never form an import
 * cycle; schema.ts runs `receiptProblems` in the Receipt's superRefine. PURE (Hard Rule 4).
 *
 *  - `override` iff USER_OVERRIDDEN, and `override.at ≥ computedAt`;
 *  - `finalAt` iff the state before any override is FINAL;
 *  - grade UNASKED iff `attribution: 'likely'` and no `claimId`; `attribution` and `supersededBy` on UNASKED only;
 *  - the lifecycle reasons: `override.user {grade: override.grade}` iff `override`, `superseded {claimId:
 *    supersededBy}` iff `supersededBy`, each once, after every graded reason, in §15 order.
 */
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
  readonly reasons: readonly unknown[];
  readonly computedAt: string;
  readonly finalAt?: string | undefined;
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

export function receiptProblems(receipt: ReceiptFacts): Problem[] {
  return [
    ...stateProblems(receipt),
    ...unaskedProblems(receipt),
    ...overrideProblems(receipt),
    ...lifecycleProblems(receipt),
  ];
}
