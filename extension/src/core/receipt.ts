/**
 * Receipts (docs/grading.md §3, §8, §10, §15; module contract §13 `receipt.ts`).
 *
 *  - `receiptId(subject)`: stable per subject, never per input: `idFromHash(sha256Hex(canonicalJson(K)))` with
 *    `K = {k:'claim', claimId}`, `{k:'unasked', observationId}` or `{k:'scope', agent, scope}`. A regrade
 *    replaces the PENDING row with the same id (idempotent).
 *  - `inputsHash(inputs)` (receipt-hash.ts): what replay proves; `grantHash` and `coverageHash` are its per-batch
 *    sub-hashes (§3 v1.4).
 *  - `buildReceipt(parts)`: assembles a Receipt whose §8 invariants hold by construction: `state` is FINAL iff
 *    the parts say final, and then `finalAt = computedAt` (the evaluatedAt of the grading that met the FINAL
 *    condition); `attribution: 'likely'` iff the grade is UNASKED, which never has a claim; no `override` and no
 *    `supersededBy` (state.ts adds those). Reasons are ordered per §15.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { GradeError } from './grade-error';
import { canonicalJson, idFromHash, sha256Hex } from './hash';
import {
  type AgentId,
  type Claim,
  type Grade,
  type IsoTs,
  type Reason,
  ReasonCode,
  type Receipt,
  type Sha256,
  Ulid,
} from './schema';

export {
  coverageHash,
  type GradeInputs,
  grantHash,
  inputsHash,
  rememberById,
  uniqueById,
  uniqueRows,
} from './receipt-hash';

/** What a receipt is about (§3): its id derives from this alone. */
export type ReceiptSubject =
  | { readonly k: 'claim'; readonly claimId: Ulid }
  | { readonly k: 'unasked'; readonly observationId: Ulid }
  | { readonly k: 'scope'; readonly agent: AgentId; readonly scope: string };

/** §3: the receipt id of a subject. The same subject always gets the same id. */
export function receiptId(subject: ReceiptSubject): Ulid {
  return Ulid.parse(idFromHash(sha256Hex(canonicalJson(subject))));
}

/**
 * `code` as a ReasonCode, or `GradeError('unknown_reason_code')` when the core schema does not list it (a schema
 * older than the contract): a reason is never silently dropped (Hard Rule 6).
 */
export function reasonCode(code: string): ReasonCode {
  const known = ReasonCode.options.find((option) => option === code);
  if (known === undefined) throw new GradeError('unknown_reason_code');
  return known;
}

/**
 * §15 reason groups, emitted in this order: the rule's own codes, then `allowlist.unchecked`, then coverage
 * reasons, then match and counterparty reasons. Within a group reasons are ordered by code (table order, the
 * order of `ReasonCode`); reasons sharing a code keep the order given (callers give sources in policy order).
 * `override.user` and `superseded` come last and are added by state.ts, never here.
 */
export interface ReasonGroups {
  readonly rule: readonly Reason[];
  readonly allowlist: readonly Reason[];
  readonly coverage: readonly Reason[];
  readonly match: readonly Reason[];
}

const CODE_ORDER: ReadonlyMap<string, number> = new Map(
  ReasonCode.options.map((code, index) => [code, index]),
);

function codeIndex(reason: Reason): number {
  return CODE_ORDER.get(reason.code) ?? CODE_ORDER.size;
}

/** §15 order: group by group, each in table order (a stable sort keeps the given order within one code). */
export function orderReasons(groups: ReasonGroups): Reason[] {
  return [groups.rule, groups.allowlist, groups.coverage, groups.match].flatMap((group) =>
    [...group].sort((a, b) => codeIndex(a) - codeIndex(b)),
  );
}

/** Everything `buildReceipt` needs; the builder derives the rest. */
export interface ReceiptParts {
  readonly subject: ReceiptSubject;
  readonly agent: AgentId;
  /** The graded claim, or null for an UNASKED or scope-diff receipt. */
  readonly claim: Claim | null;
  readonly observationIds: readonly Ulid[];
  /** For a PENDING outcome, the UNVERIFIABLE placeholder (§2). */
  readonly grade: Grade;
  readonly confidence: number;
  readonly ruleId: string;
  readonly reasons: ReasonGroups;
  readonly signals: Readonly<Record<string, number>>;
  readonly final: boolean;
  readonly policyHash: Sha256;
  readonly inputsHash: Sha256;
  /** `coverage.evaluatedAt` (§3). */
  readonly computedAt: IsoTs;
}

/** Assembles a schema-valid Receipt (§8 invariants by construction). */
export function buildReceipt(parts: ReceiptParts): Receipt {
  const { claim, final } = parts;
  if (parts.grade === 'UNASKED' && claim !== null) throw new GradeError('unasked_with_claim');
  return {
    id: receiptId(parts.subject),
    agent: parts.agent,
    ...(claim === null ? {} : { claimId: claim.id }),
    observationIds: [...parts.observationIds],
    ...(claim?.requestId === undefined ? {} : { requestId: claim.requestId }),
    grade: parts.grade,
    confidence: parts.confidence,
    ruleId: parts.ruleId,
    reasons: orderReasons(parts.reasons),
    signals: { ...parts.signals },
    state: final ? 'FINAL' : 'PENDING',
    policyHash: parts.policyHash,
    inputsHash: parts.inputsHash,
    ...(parts.grade === 'UNASKED' ? { attribution: 'likely' as const } : {}),
    computedAt: parts.computedAt,
    ...(final ? { finalAt: parts.computedAt } : {}),
  };
}
