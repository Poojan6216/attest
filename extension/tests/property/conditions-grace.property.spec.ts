/**
 * The exported `graceElapsed` and `coverageLevel` wrappers (docs/grading.md §6.1, §13 `conditions.ts`) against the
 * evaluators `grade()` actually decides with (`evaluateConditions`), and against `grade()` itself (QA Sprint 1
 * review: the wrappers are read only by tests and could drift from the decision path unnoticed).
 *
 *  1. For any claim, grant, coverage and policy, `graceElapsed(...)` is the evaluator's per-source verdict with every
 *     source elapsed, and `coverageLevel(...)` is the evaluator's `coverage()`.
 *  2. Under policies whose `pending` rule is `{ graceElapsed: false }` and that keep the §6.2 order after it:
 *     `pending` is chosen only while grace has not elapsed, and `partial_coverage`, `not_found` and the terminal rule
 *     are reached only once it has; a NOT_FOUND also needs full coverage (§6.2 `not_found.when`).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { coverageLevel, evaluateConditions, graceElapsed } from '../../src/core/conditions';
import { grade } from '../../src/core/grade';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy, TERMINAL_RULE_ID } from '../../src/core/policy';
import { ActionType, type Claim, type Coverage, type Grant } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import { buildClaim, buildCoverage, buildGrant, mergePatch } from '../golden/build';
import { ScenarioClaim, ScenarioCoverage, ScenarioGrant } from '../golden/scenario-schema';

const PROPERTY_TIMEOUT_MS = 120_000;
const RUNS = { numRuns: 1_000 };
const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const OFFSETS = [-240, 0, 345, 840, -720];
const SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
const ACCOUNTS = ['acct-a', 'acct-b'];

/** Policies that keep `pending = { graceElapsed: false }` and the §6.2 order after it (property 2 reads both). */
const POLICIES: readonly Policy[] = [
  DEFAULT_POLICY,
  loadPolicy(
    mergePatch(defaultPolicyJson, { windows: { afterClaimMin: 10, graceMin: 60, calendarDays: 1 } }),
  ),
  loadPolicy(mergePatch(defaultPolicyJson, { receiptMerchants: ['acme'] })),
  loadPolicy(
    mergePatch(defaultPolicyJson, { sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } }),
  ),
];
const AFTER_PENDING = new Set(['partial_coverage', 'not_found', TERMINAL_RULE_ID]);

const optional = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });
const defined = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
const iso = (minMinutes: number, maxMinutes: number) =>
  fc
    .tuple(fc.integer({ min: minMinutes, max: maxMinutes }), fc.constantFrom(...OFFSETS))
    .map(([minutes, offset]) => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, offset));

const claimArb = fc
  .record({
    type: fc.constantFrom(...ActionType.options),
    counterparty: optional(fc.constantFrom('priya@company.com', 'Priya', 'acme', 'Acme')),
    subjectHint: optional(fc.constantFrom('Q3 deck', 'Invoice 42')),
    amountCents: optional(fc.integer({ min: 0, max: 9_000 })),
    currency: optional(fc.constantFrom('USD', 'EUR')),
    claimedAt: iso(0, 240),
    claimedAtPrecision: fc.constantFrom('minute', 'hour', 'day'),
    targetAt: optional(iso(-3_000, 3_000)),
  })
  .map((raw) => buildClaim(ScenarioClaim.parse(defined({ ref: 'c1', agent: 'muse', ...raw }))));

/** Entries around the claims, synced from just before them to well after every grace (and some in the future). */
const entryArb = fc
  .record({
    source: fc.constantFrom(...SOURCES),
    start: fc.integer({ min: -4_400, max: 300 }),
    length: fc.integer({ min: 0, max: 9_000 }),
    lag: fc.integer({ min: 0, max: 1_600 }),
    accountHash: optional(fc.constantFrom(...ACCOUNTS)),
    allCalendars: optional(fc.boolean()),
  })
  .map(({ source, start, length, lag, accountHash, allCalendars }) => {
    const at = (minutes: number) => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, -240);
    return ScenarioCoverage.parse(
      defined({
        source,
        windowStart: at(start),
        windowEnd: at(start + length),
        lastSyncAt: at(start + length + lag),
        accountHash,
        allCalendars: source === 'gcal.event' ? allCalendars : undefined,
      }),
    );
  });

const grantArb = optional(
  fc.record({
    'gmail.sent': fc.subarray(ACCOUNTS, { minLength: 1 }),
    'gcal.event': fc.subarray(ACCOUNTS, { minLength: 1 }),
  }),
).map((accounts) => ScenarioGrant.parse(defined({ agent: 'muse', accounts })));

interface Case {
  readonly claim: Claim;
  readonly grant: Grant;
  readonly coverage: Coverage;
  readonly policy: Policy;
}

/**
 * Every source seen whole, bound to its account, synced long after grace, and graded after the sync: the cases
 * where `not_found` can match. The random entries above reach it about 3 times in 1,000, too rarely to pin it.
 */
const coveredArb: fc.Arbitrary<Case> = fc
  .record({ claim: claimArb, policy: fc.constantFrom(...POLICIES) })
  .map(({ claim, policy }) => {
    const at = (minutes: number) => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, -240);
    const evaluatedAt = at(3_100);
    const entries = SOURCES.map((source) =>
      ScenarioCoverage.parse(
        defined({
          source,
          windowStart: at(-4_400),
          windowEnd: at(3_000),
          lastSyncAt: at(3_010),
          accountHash: 'acct-a',
          allCalendars: source === 'gcal.event' ? true : undefined,
        }),
      ),
    );
    const grant = ScenarioGrant.parse({
      agent: 'muse',
      accounts: { 'gmail.sent': ['acct-a'], 'gcal.event': ['acct-a'] },
    });
    return {
      claim,
      grant: buildGrant(grant, evaluatedAt),
      coverage: buildCoverage(entries, evaluatedAt),
      policy,
    };
  });

const randomArb: fc.Arbitrary<Case> = fc
  .record({
    claim: claimArb,
    grant: grantArb,
    entries: fc.array(entryArb, { maxLength: 4 }),
    evaluatedAt: iso(0, 3_000),
    policy: fc.constantFrom(...POLICIES),
  })
  .map(({ claim, grant, entries, evaluatedAt, policy }) => ({
    claim,
    grant: buildGrant(grant, evaluatedAt),
    coverage: buildCoverage(entries, evaluatedAt),
    policy,
  }));

const caseArb: fc.Arbitrary<Case> = fc.oneof(
  { arbitrary: randomArb, weight: 4 },
  { arbitrary: coveredArb, weight: 1 },
);

function evaluators(c: Case) {
  return evaluateConditions({
    claim: c.claim,
    grant: c.grant,
    policy: c.policy,
    coverage: c.coverage,
    context: { priorSpendCents: 0 },
    bestScore: null,
    assigned: null,
  });
}

describe('graceElapsed and coverageLevel are what grade() decides with (§6.1)', () => {
  it(
    'graceElapsed(...) is the evaluator verdict; coverageLevel(...) is the evaluator coverage',
    () => {
      fc.assert(
        fc.property(caseArb, (c) => {
          const evaluated = evaluators(c);
          const sources = evaluated.graceElapsed() ?? [];
          const wrapper = graceElapsed(c.claim, c.grant, c.coverage, c.policy);
          expect(wrapper).toBe(sources.every((source) => source.elapsed));
          expect(coverageLevel(c.claim, c.grant, c.coverage, c.policy)).toEqual(evaluated.coverage());
        }),
        RUNS,
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'pending only while grace has not elapsed; the rules after it only once it has; NOT_FOUND needs full coverage',
    () => {
      const reached = new Set<string>();
      fc.assert(
        fc.property(caseArb, (c) => {
          const receipt = grade(c.claim, [], c.grant, c.policy, c.coverage, { priorSpendCents: 0 });
          const elapsed = graceElapsed(c.claim, c.grant, c.coverage, c.policy);
          reached.add(`${receipt.ruleId} ${String(elapsed)}`);
          if (receipt.ruleId === 'pending') expect(elapsed).toBe(false);
          if (AFTER_PENDING.has(receipt.ruleId)) expect(elapsed).toBe(true);
          if (receipt.grade === 'NOT_FOUND') {
            expect(coverageLevel(c.claim, c.grant, c.coverage, c.policy).level).toBe('full');
          }
        }),
        RUNS,
      );
      for (const outcome of [
        'pending false',
        'not_found true',
        'partial_coverage true',
        'no_coverage true',
      ]) {
        expect(reached, `the cases reach ${outcome}`).toContain(outcome);
      }
    },
    PROPERTY_TIMEOUT_MS,
  );
});
