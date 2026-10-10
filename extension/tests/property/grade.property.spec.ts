/**
 * Task 1.5 Done-when (Hard Rule 4; ledger_engineer rule 10): `grade()` is deterministic.
 *
 *  1. 5,000 random (claim, candidates, grant, policy patch, coverage, context) tuples, each graded twice, give
 *     identical receipts; every receipt has a ruleId (a policy rule or the terminal one) and parses with the
 *     Receipt schema.
 *  2. 5,000 random tuples: permuting the candidates, `coverage.observers`, the grant's set-like arrays and the
 *     attribution's signals, and repeating candidates, observers and list entries, gives the identical receipt
 *     (id, inputsHash, everything).
 *
 * Inputs are built by ./grade-tuples.ts with the golden loader's builders, so each tuple is a valid grading input;
 * claim-less tuples have exactly one subject (an orphan or a scope), as gradeBatch passes, and a claim's candidates are
 * §4.1 candidates of it, the only ones grade() accepts (grade-guard.ts; grade-guard.property.spec.ts pins the refusal
 * of every other).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { grade } from '../../src/core/grade';
import { canonicalJson } from '../../src/core/hash';
import { TERMINAL_RULE_ID } from '../../src/core/policy';
import { Receipt } from '../../src/core/schema';
import { POLICIES, type Tuple, tupleArb } from './grade-tuples';

/** Each property builds and grades twice per run; a busy machine must not turn a timeout into a failure. */
const PROPERTY_TIMEOUT_MS = 300_000;
const RUNS = 5_000;
/** Distinct (ruleId, state) pairs the random tuples must reach, so determinism is not proved on one path. */
const MIN_OUTCOMES = 18;
const gradeTuple = (t: Tuple) => grade(t.claim, t.candidates, t.grant, t.policy, t.coverage, t.context);

/** A permutation of `values` driven by `keys` (stable on equal keys). */
function permute<T>(values: readonly T[], keys: readonly number[]): T[] {
  return values
    .map((value, i) => ({ value, key: keys[i % Math.max(keys.length, 1)] ?? 0, i }))
    .sort((a, b) => a.key - b.key || b.i - a.i)
    .map(({ value }) => value);
}

/** The same inputs as sets: every set-like array permuted, and candidates, observers and lists repeated. */
function shuffled(t: Tuple, keys: readonly number[]): Tuple {
  const { grant, coverage, context } = t;
  const twice = <T>(values: readonly T[]): T[] => permute([...values, ...values.slice(0, 1)], keys);
  const accounts = grant.accounts?.['gmail.sent'];
  return {
    ...t,
    candidates: twice(t.candidates),
    coverage: { ...coverage, observers: twice(coverage.observers) },
    grant: {
      ...grant,
      allowedTypes: permute(grant.allowedTypes, keys),
      counterpartyAllowlist: twice(grant.counterpartyAllowlist),
      declaredScopes: twice(grant.declaredScopes),
      ...(grant.observedScopes === undefined ? {} : { observedScopes: twice(grant.observedScopes) }),
      ...(accounts === undefined ? {} : { accounts: { 'gmail.sent': twice(accounts) } }),
    },
    context:
      context.attribution === undefined
        ? context
        : {
            ...context,
            attribution: { ...context.attribution, signals: permute(context.attribution.signals, keys) },
          },
  };
}

const RULE_IDS = new Set([
  ...POLICIES.flatMap((policy) => policy.rules.map((rule) => rule.id)),
  TERMINAL_RULE_ID,
]);

describe('grade() is deterministic (task 1.5 Done-when, Hard Rule 4)', () => {
  it(
    `${String(RUNS)} random tuples graded twice give identical, schema-valid receipts with a ruleId`,
    () => {
      const seen = new Set<string>();
      fc.assert(
        fc.property(tupleArb, (tuple) => {
          const first = gradeTuple(tuple);
          const second = gradeTuple(tuple);
          seen.add(`${first.ruleId}/${first.state}`);
          expect(second).toEqual(first);
          expect(canonicalJson(second)).toBe(canonicalJson(first));
          expect(RULE_IDS.has(first.ruleId)).toBe(true);
          expect(Receipt.parse(first)).toEqual(first);
        }),
        { numRuns: RUNS },
      );
      // The tuples reach every rule of the default order, in both states where a rule has two.
      expect(seen.size).toBeGreaterThanOrEqual(MIN_OUTCOMES);
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    `${String(RUNS)} random tuples: permuting and repeating set members gives the identical receipt`,
    () => {
      fc.assert(
        fc.property(tupleArb, fc.array(fc.nat(), { minLength: 1, maxLength: 16 }), (tuple, keys) => {
          const receipt = gradeTuple(tuple);
          const permuted = gradeTuple(shuffled(tuple, keys));
          expect(canonicalJson(permuted)).toBe(canonicalJson(receipt));
        }),
        { numRuns: RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
