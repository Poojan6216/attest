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
 * Inputs are built by the golden loader's builders (schema-parsed, every id and hash computed), so each tuple is
 * a valid grading input; claim-less tuples have exactly one subject (an orphan or a scope), as gradeBatch passes.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { grade } from '../../src/core/grade';
import { canonicalJson } from '../../src/core/hash';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy, TERMINAL_RULE_ID } from '../../src/core/policy';
import {
  ActionType,
  Attribution,
  type Claim,
  type Coverage,
  type GradeContext,
  type Grant,
  type Observation,
  Receipt,
} from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import {
  buildClaim,
  buildCoverage,
  buildGrant,
  buildObservation,
  mergePatch,
  PolicyView,
} from '../golden/build';
import {
  ScenarioClaim,
  ScenarioCoverage,
  ScenarioGrant,
  ScenarioObservation,
} from '../golden/scenario-schema';

/** Each property builds and grades twice per run; a busy machine must not turn a timeout into a failure. */
const PROPERTY_TIMEOUT_MS = 300_000;
const RUNS = 5_000;
/** Distinct (ruleId, state) pairs the random tuples must reach, so determinism is not proved on one path. */
const MIN_OUTCOMES = 18;
const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const OFFSETS = [-240, 0, 345, 60, -420];
const VIEW = PolicyView.parse(defaultPolicyJson);

const POLICIES: readonly Policy[] = [
  DEFAULT_POLICY,
  loadPolicy(mergePatch(defaultPolicyJson, { thresholds: { verified: 0.7, partial: 0.3 } })),
  loadPolicy(
    mergePatch(defaultPolicyJson, {
      windows: { afterClaimMin: 10, graceMin: 5, finalizeUnverifiableHours: 2 },
    }),
  ),
  loadPolicy(mergePatch(defaultPolicyJson, { receiptMerchants: ['acme'] })),
  loadPolicy(
    mergePatch(defaultPolicyJson, { sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } }),
  ),
  loadPolicy(mergePatch(defaultPolicyJson, { rules: [...defaultPolicyJson.rules].reverse() })),
];

const ADDRESSES = [
  'priya@company.com',
  'raj@company.com',
  'priya+x@company.com',
  'prıya@company.com',
  'a@gmail.com',
];
const NAMES = ['Priya', 'Priya Raman', 'acme', 'Corner Shop'];
const SUBJECTS = ['Q3 deck', 'Q3 budget', 'Re: hiring plan', 'Invoice 42'];
const CURRENCIES = ['USD', 'EUR', 'CAD'];
const SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
const ACCOUNTS = ['acct-a', 'acct-b'];

/** An instant near the base, in one of several offsets, sometimes with seconds. */
const iso = (minMinutes: number, maxMinutes: number) =>
  fc
    .tuple(
      fc.integer({ min: minMinutes, max: maxMinutes }),
      fc.integer({ min: 0, max: 59 }),
      fc.constantFrom(...OFFSETS),
    )
    .map(([minutes, seconds, offset]) =>
      isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE + seconds * 1_000, offset),
    );

const optional = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });
const defined = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

const claimArb = fc
  .record({
    type: fc.constantFrom(...ActionType.options),
    counterparty: optional(fc.constantFrom(...ADDRESSES, ...NAMES)),
    subjectHint: optional(fc.constantFrom(...SUBJECTS)),
    amountCents: optional(fc.integer({ min: 0, max: 9_000 })),
    currency: optional(fc.constantFrom(...CURRENCIES)),
    claimedAt: iso(0, 240),
    claimedAtPrecision: fc.constantFrom('minute', 'hour', 'day'),
    targetAt: optional(iso(-3_000, 3_000)),
    text: fc.constantFrom('c', 'sent it', 'done'),
  })
  .map((raw) => buildClaim(ScenarioClaim.parse(defined({ ref: 'c1', agent: 'muse', ...raw }))));

const observationArb = fc
  .record({
    source: fc.constantFrom(...SOURCES),
    type: fc.constantFrom(...ActionType.options),
    counterparty: optional(fc.constantFrom(...ADDRESSES)),
    merchant: optional(fc.constantFrom('Acme', 'Corner Shop')),
    subjectHint: optional(fc.constantFrom(...SUBJECTS)),
    amountCents: optional(fc.integer({ min: 0, max: 9_000 })),
    currency: optional(fc.constantFrom(...CURRENCIES)),
    occurredAt: iso(-60, 300),
    observedAt: iso(0, 1_600),
  })
  .map((raw) =>
    buildObservation(ScenarioObservation.parse(defined({ ref: 'o1', ...raw })), [], raw.observedAt, VIEW),
  );

const coverageEntryArb = fc
  .record({
    source: fc.constantFrom(...SOURCES),
    start: fc.integer({ min: -600, max: 300 }),
    length: fc.integer({ min: 0, max: 900 }),
    lag: fc.integer({ min: 0, max: 900 }),
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

const grantArb = fc
  .record({
    allowedTypes: fc.subarray([...ActionType.options]),
    counterpartyAllowlist: fc.subarray(['company.com', 'priya@company.com', 'gmail.com']),
    ceiling: fc.boolean(),
    declaredScopes: fc.subarray(['gmail.send', 'gmail.read', 'calendar.write']),
    observedScopes: optional(fc.subarray(['gmail.send', 'gmail.read'])),
    accounts: optional(fc.record({ 'gmail.sent': fc.subarray(ACCOUNTS, { minLength: 1 }) })),
  })
  .map(({ ceiling, ...raw }) =>
    ScenarioGrant.parse(
      defined({
        agent: 'muse',
        ...raw,
        ...(ceiling ? { spendCeilingCents: 5_000, spendCurrency: 'USD' } : {}),
      }),
    ),
  );

const attributionArb = fc
  .record({
    scoreBp: fc.integer({ min: 0, max: 10_000 }),
    signals: fc
      .subarray(['agentSessionActive', 'userIdle', 'agentSignature', 'activityLogAdjacent'], { minLength: 1 })
      .filter((signals) => signals.some((signal) => signal !== 'userIdle')),
    adapterLastSyncAt: optional(iso(0, 1_600)),
  })
  .map((raw) => Attribution.parse(defined({ agent: 'muse', ...raw })));

interface Tuple {
  readonly claim: Claim | null;
  readonly candidates: readonly Observation[];
  readonly grant: Grant;
  readonly policy: Policy;
  readonly coverage: Coverage;
  readonly context: GradeContext;
}

const shared = fc.record({
  grant: grantArb,
  policy: fc.constantFrom(...POLICIES),
  entries: fc.array(coverageEntryArb, { maxLength: 4 }),
  evaluatedAt: iso(0, 2_000),
  priorSpendCents: fc.integer({ min: 0, max: 9_000 }),
});

/** A claim with up to five candidates (often its own type), or a claim-less tuple with exactly one subject. */
const tupleArb: fc.Arbitrary<Tuple> = fc
  .record({
    shared,
    claim: fc.option(claimArb, { freq: 8 }),
    candidates: fc.array(observationArb, { maxLength: 5 }),
    attribution: optional(attributionArb),
    scope: optional(fc.constantFrom('gmail.read', 'gmail.send')),
  })
  .map(({ shared: s, claim, candidates, attribution, scope }) => {
    const coverage = buildCoverage(s.entries, s.evaluatedAt);
    const grant = buildGrant(s.grant, s.evaluatedAt);
    if (claim !== null) {
      const own = candidates.map((candidate, i) =>
        i % 2 === 0 ? { ...candidate, type: claim.type } : candidate,
      );
      const context: GradeContext = {
        priorSpendCents: s.priorSpendCents,
        ...(attribution === undefined ? {} : { attribution }),
        ...(scope === undefined ? {} : { scope: { observed: scope } }),
      };
      return { claim, candidates: own, grant, policy: s.policy, coverage, context };
    }
    const orphan = candidates[0];
    const visible = orphan === undefined ? undefined : { ...orphan, observedAt: coverage.evaluatedAt };
    const context: GradeContext =
      visible === undefined
        ? { priorSpendCents: 0, scope: { observed: scope ?? 'gmail.read' } }
        : { priorSpendCents: 0, ...(attribution === undefined ? {} : { attribution }) };
    return {
      claim: null,
      candidates: visible === undefined ? [] : [visible],
      grant,
      policy: s.policy,
      coverage,
      context,
    };
  });

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
