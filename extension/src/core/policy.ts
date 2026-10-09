/**
 * The grading policy, version 2 (docs/grading.md §12, §5.3, §13; ledger_engineer rule 2: policy is data).
 *
 * Every threshold, window, feature weight, rule, and allowlisted field lives in `policy/default.json` and
 * nowhere in code (a unit test walks the source AST to prove it). `loadPolicy` validates a document
 * strictly (field by field in `./policy-schema`, across fields in `./policy-checks`) and returns a
 * deep-frozen `Policy`: the document's fields as written, plus
 *  - `bp`: every weight, threshold and unasked weight as integer basis points (exact; a value that is not
 *    a multiple of 0.0001 is rejected at load), and
 *  - `policyHash`: SHA-256 of the document's canonical JSON, stored on every receipt.
 * Nothing downstream can retune a threshold at runtime (Hard Rule 4). The loader is the only source of a
 * `Policy`: every grading entry refuses an object `loadPolicy` did not return (`assertLoadedPolicy`), so no copy,
 * spread, hand-built or edited object is ever graded from stale memos or stamped with another document's hash.
 *
 * PURE: no I/O, no clock, no logging. The JSON import is resolved at build time, not read at runtime.
 * A failure throws `PolicyError` with one specific "path: problem" line per issue; the caller logs it.
 */
import { z } from 'zod';

import defaultPolicyJson from '../../../policy/default.json';
import { canonicalJson, sha256Hex } from './hash';
import { policyIssues } from './policy-checks';
import { describeIssue, formatIssues, PolicyError } from './policy-errors';
import {
  FeatureName,
  type PolicyDocument as PolicyDocumentType,
  PolicyShape,
  SignalName,
  type ThresholdName,
} from './policy-schema';
import { Sha256 } from './schema';
import { BASIS_POINTS } from './units';

export { PolicyError, type PolicyErrorCode } from './policy-errors';
export {
  ALLOWLISTABLE_FIELDS,
  ConditionName,
  CoverageLevel,
  FeatureName,
  isBasisPointMultiple,
  ObservationFieldName,
  PENDING_RULE_ID,
  RuleOutcome,
  SignalName,
  TERMINAL_RULE_ID,
  ThresholdName,
} from './policy-schema';

/** The whole policy document: every field's schema plus the cross-field checks. Strict at every level. */
export const PolicyDocument = PolicyShape.superRefine((doc, ctx) => {
  for (const issue of policyIssues(doc)) {
    ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message });
  }
});

/** An integer in [0, BASIS_POINTS]: 8500 means 0.85. Grade-relevant comparisons use only these (§5.3). */
export const BasisPoints = z.number().int().min(0).max(BASIS_POINTS).brand<'BasisPoints'>();

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** The `bp` section of a loaded policy: the same paths as the document, in integer basis points. */
export interface PolicyBasisPoints {
  readonly features: Readonly<Record<FeatureName, BasisPoints>>;
  readonly thresholds: Readonly<Record<ThresholdName, BasisPoints>>;
  readonly unasked: {
    readonly signals: Readonly<Record<SignalName, BasisPoints>>;
    readonly threshold: BasisPoints;
  };
}

/**
 * A loaded policy. Deep-readonly in the type system and deep-frozen at runtime.
 *
 * COMPARE ONLY `policy.bp`. The decimal `thresholds`, `features`, `unasked.signals` and `unasked.threshold`
 * are the document as written: they exist for display and for `policyHash`, and are never compared,
 * summed or multiplied to decide anything (§5.3: no grade is decided in floating point). Every threshold
 * test, weighted score and attribution score reads the integer basis points in `bp` instead.
 */
export type Policy = DeepReadonly<PolicyDocumentType> & {
  /** Integer basis points for every weight and threshold: the only numbers a comparison may use. */
  readonly bp: PolicyBasisPoints;
  /** SHA-256 hex of `canonicalJson(document)`: identical for the same document whatever its key order. */
  readonly policyHash: Sha256;
};

export type PolicyDocument = PolicyDocumentType;
export type PolicyRule = Policy['rules'][number];
export type BasisPoints = z.infer<typeof BasisPoints>;

/**
 * Exact for a validated weight (`isBasisPointMultiple` held at parse time); the parse pins the range.
 * `Math.abs` only turns a written `-0` (which passes `min(0)`) into `0`, so every bp value is a plain
 * non-negative integer and `Object.is(bp, 0)` holds for a zero weight however it was written.
 */
function toBasisPoints(weight: number): BasisPoints {
  return BasisPoints.parse(Math.abs(Math.round(weight * BASIS_POINTS)));
}

function allToBasisPoints<Key extends string>(
  keys: readonly Key[],
  weights: Readonly<Record<Key, number>>,
): Record<Key, BasisPoints> {
  return Object.fromEntries(keys.map((key) => [key, toBasisPoints(weights[key])])) as Record<
    Key,
    BasisPoints
  >;
}

function basisPointsOf(doc: PolicyDocumentType): PolicyBasisPoints {
  return {
    features: allToBasisPoints(FeatureName.options, doc.features),
    thresholds: {
      verified: toBasisPoints(doc.thresholds.verified),
      partial: toBasisPoints(doc.thresholds.partial),
    },
    unasked: {
      signals: allToBasisPoints(SignalName.options, doc.unasked.signals),
      threshold: toBasisPoints(doc.unasked.threshold),
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child: unknown) => {
      deepFreeze(child);
    });
    Object.freeze(value);
  }
  return value;
}

/**
 * Every policy `loadPolicy` returned, and nothing else (docs/grading.md §3: "the loaded, frozen policy"). A memo
 * keyed on a policy's parts (features.ts) and the `policyHash` a receipt carries are right only for an object the
 * loader validated, hashed and froze. Weakly held: it never keeps a policy alive and stores no data of its own.
 */
const LOADED = new WeakSet<object>();

/**
 * The `rules` array of every policy `loadPolicy` returned (deep-frozen plain data the loader built, never the
 * caller's array): conditions.ts `firstMatch` remembers its per-rule work only for these, so no other array, frozen
 * or not, accessor-bearing or not, is ever read from a stale memo (Hard Rule 4).
 */
const LOADED_RULES = new WeakSet<object>();

/**
 * Validates `raw` as a policy document and returns a deep-frozen `Policy` (the input is never frozen or
 * retained). Throws `PolicyError` listing every problem found, each naming its path.
 *
 * `jitless` keeps Zod off its `new Function` fast path, so the policy parses the same way in Node tests
 * as under the extension's CSP (Hard Rule 9).
 */
export function loadPolicy(raw: unknown): Policy {
  const result = PolicyDocument.safeParse(raw, { error: describeIssue, jitless: true });
  if (!result.success) throw new PolicyError(formatIssues(result.error.issues));
  const doc = result.data;
  const policyHash = Sha256.parse(sha256Hex(canonicalJson(doc)));
  const policy = deepFreeze({ ...doc, bp: basisPointsOf(doc), policyHash });
  LOADED.add(policy);
  LOADED_RULES.add(policy.rules);
  return policy;
}

/**
 * Throws `PolicyError('policy_not_loaded')` unless `policy` is an object `loadPolicy` returned (Hard Rules 4 and
 * 6). Every entry that grades or scores with a policy calls it first: `grade`, `gradeOrphan`, `gradeClaim`,
 * `gradeBatch`, and the features.ts claim plan behind `features`, `pairScorer`, `RowScorer` and `isAssignable`.
 * A copy (`{ ...policy, windows }`) is refused even when every value is valid: it keeps the original's
 * `policyHash`, so its receipts would name a document they were not graded with.
 */
export function assertLoadedPolicy(policy: object): void {
  if (!LOADED.has(policy)) throw new PolicyError([], 'policy_not_loaded');
}

/** Whether `rules` is the `rules` array of a policy `loadPolicy` returned (the only arrays a memo may key on). */
export function isLoadedRules(rules: object): boolean {
  return LOADED_RULES.has(rules);
}

/**
 * The shipped policy. Loaded at module evaluation, so a broken `policy/default.json` fails loudly at
 * startup instead of grading with a half-valid policy (Hard Rule 6).
 */
export const DEFAULT_POLICY: Policy = loadPolicy(defaultPolicyJson);

/** The shipped policy document as written (policy/default.json): what the ledger stores beside DEFAULT_POLICY's receipts. */
export const DEFAULT_POLICY_DOCUMENT: unknown = defaultPolicyJson;
