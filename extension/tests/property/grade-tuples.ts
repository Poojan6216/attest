/**
 * Random grading inputs for the core's grade() properties (tests/property/grade.property.spec.ts: determinism, task
 * 1.5; tests/property/monotonicity.spec.ts: the model never grades, sprint_5 5.0). Each tuple is a valid grading
 * input, built by the golden loader's builders (schema-parsed, every id and hash computed): a claim with up to five of
 * its §4.1 candidates (`asCandidateOf`, the only ones grade() accepts), or a claim-less tuple with exactly one subject
 * (an orphan or a scope), as gradeBatch passes, under the shipped policy and five variants of it.
 */
import fc from 'fast-check';

import defaultPolicyJson from '../../../policy/default.json';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../src/core/policy';
import {
  ActionType,
  Attribution,
  type Claim,
  type Coverage,
  type GradeContext,
  type Grant,
  IsoTs,
  type Observation,
} from '../../src/core/schema';
import { firstSeenFromMs } from '../../src/core/order';
import { MS_PER_MINUTE } from '../../src/core/units';
import { claimWindow, writtenOffsetMinutes } from '../../src/core/window';
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

const BASE_MS = instantMs('2026-10-06T12:00:00-04:00');
const OFFSETS = [-240, 0, 345, 60, -420];
const VIEW = PolicyView.parse(defaultPolicyJson);

export const POLICIES: readonly Policy[] = [
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

/**
 * `candidate` as a §4.1 candidate of `claim`: the claim's type, its own source when the policy lists it for that type
 * (else the type's first one), and an `occurredAt` outside the claim window moved to its nearest edge (in the offset
 * it was written in); null when the claim has no window (a calendar claim without `targetAt`), its type no source,
 * or a `calendar.created` event was seen before the claim's first-seen bound.
 */
function asCandidateOf(claim: Claim, candidate: Observation, policy: Policy): Observation | null {
  const window = claimWindow(claim, policy);
  const from = firstSeenFromMs(claim, policy);
  const sources = policy.sourcesByType[claim.type];
  const source = sources.includes(candidate.source) ? candidate.source : sources[0];
  if (window === null || source === undefined) return null;
  if (from !== null && instantMs(candidate.observedAt) < from) return null;
  const atMs = instantMs(candidate.occurredAt);
  const edgeMs = Math.min(Math.max(atMs, window.fromMs), window.toMs);
  const occurredAt =
    edgeMs === atMs
      ? candidate.occurredAt
      : IsoTs.parse(isoWithOffset(edgeMs, writtenOffsetMinutes(candidate.occurredAt)));
  return { ...candidate, type: claim.type, source, occurredAt };
}

export interface Tuple {
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

/** A claim with up to five of its §4.1 candidates, or a claim-less tuple with exactly one subject. */
export const tupleArb: fc.Arbitrary<Tuple> = fc
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
      const own = candidates.flatMap((candidate) => asCandidateOf(claim, candidate, s.policy) ?? []);
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
