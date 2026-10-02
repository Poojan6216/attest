/**
 * Task 1.5 Done-when: every rule fires in a unit test (docs/grading.md §6.2), with its grade, state, evidence and
 * exact reasons (§15). One case per rule in `policy/default.json`, plus the terminal `default_unverifiable`; a
 * meta-test proves the table names every rule.
 *
 * The email claim is at 14:02 (window [14:00, 14:48]); the default coverage is one gmail.sent entry (acct-a,
 * no grant binding) that saw [12:00, 15:00] and synced at 15:00 = evaluatedAt.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade } from '../../../src/core/grade';
import { sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy, type Policy, TERMINAL_RULE_ID } from '../../../src/core/policy';
import {
  Attribution,
  type Claim,
  type GradeContext,
  type Grant,
  type Observation,
  type Reason,
  Receipt,
} from '../../../src/core/schema';
import {
  buildClaim,
  buildCoverage,
  buildGrant,
  buildObservation,
  mergePatch,
  PolicyView,
} from '../../golden/build';
import {
  ScenarioClaim,
  ScenarioObservation,
  type ScenarioCoverage,
  type ScenarioGrant,
} from '../../golden/scenario-schema';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const VIEW = PolicyView.parse(defaultPolicyJson);

const without = (value: Record<string, unknown>, omit: readonly string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)));

function claimOf(over: Record<string, unknown> = {}, omit: readonly string[] = []): Claim {
  const base = {
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    claimedAt: at('14:02'),
    ...over,
  };
  return buildClaim(ScenarioClaim.parse(without(base, omit)));
}

function obsOf(over: Record<string, unknown> = {}, omit: readonly string[] = []): Observation {
  const base = {
    ref: 'o1',
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    occurredAt: at('14:02'),
    observedAt: at('14:30'),
    ...over,
  };
  return buildObservation(ScenarioObservation.parse(without(base, omit)), [], EVAL, VIEW);
}

const entry = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gmail.sent',
  lastSyncAt: EVAL,
  windowStart: at('12:00'),
  windowEnd: EVAL,
  accountHash: 'acct-a',
  ...over,
});
const grantOf = (over: Partial<ScenarioGrant> = {}): Grant => buildGrant({ agent: 'muse', ...over }, EVAL);

interface Call {
  readonly claim?: Claim | null;
  readonly candidates?: readonly Observation[];
  readonly grant?: Grant;
  readonly coverage?: readonly ScenarioCoverage[];
  readonly evaluatedAt?: string;
  readonly context?: GradeContext;
  readonly policy?: Policy;
}

function run(call: Call): Receipt {
  const receipt = grade(
    call.claim === undefined ? claimOf() : call.claim,
    call.candidates ?? [],
    call.grant ?? grantOf(),
    call.policy ?? DEFAULT_POLICY,
    buildCoverage(call.coverage ?? [entry()], call.evaluatedAt ?? EVAL),
    call.context ?? { priorSpendCents: 0 },
  );
  return Receipt.parse(receipt);
}

const O1 = obsOf();
const ATTRIBUTION = Attribution.parse({
  agent: 'muse',
  scoreBp: 7000,
  signals: ['agentSessionActive', 'userIdle'],
  adapterLastSyncAt: at('14:50'),
});
const purchase = (over: Record<string, unknown>) =>
  claimOf({ type: 'purchase.made', counterparty: 'acme', ...over }, ['subjectHint']);
const CEILING = grantOf({ spendCeilingCents: 5000, spendCurrency: 'USD' });
const match = (observation: Observation): Reason => ({
  code: 'match.best',
  params: { observationId: observation.id },
});
const NONE: Reason = { code: 'match.none', params: {} };
const SOURCE = { source: 'gmail.sent' };

interface Expected {
  readonly grade: Receipt['grade'];
  readonly ruleId: string;
  readonly state: Receipt['state'];
  readonly observationIds: readonly string[];
  readonly reasons: readonly Reason[];
}

const CASES: readonly (readonly [string, () => Receipt, Expected])[] = [
  [
    'unasked: an orphan with attribution ≥ threshold',
    () => run({ claim: null, candidates: [O1], context: { priorSpendCents: 0, attribution: ATTRIBUTION } }),
    {
      grade: 'UNASKED',
      ruleId: 'unasked',
      state: 'FINAL',
      observationIds: [O1.id],
      reasons: [
        { code: 'unasked.session', params: { agent: 'muse' } },
        { code: 'unasked.idle', params: { agent: 'muse' } },
      ],
    },
  ],
  [
    'over_scope_observed: an observed scope the user did not declare',
    () =>
      run({
        claim: null,
        grant: grantOf({ declaredScopes: ['gmail.send'] }),
        context: { priorSpendCents: 0, scope: { observed: 'gmail.read' } },
      }),
    {
      grade: 'OVER_SCOPE',
      ruleId: 'over_scope_observed',
      state: 'FINAL',
      observationIds: [],
      reasons: [{ code: 'scope.observed_not_declared', params: { scopeHash: sha256Hex('gmail.read') } }],
    },
  ],
  [
    'over_scope: a type the grant does not allow, FINAL at once, with its evidence',
    () =>
      run({
        candidates: [O1],
        grant: grantOf({ allowedTypes: ['calendar.created'] }),
        coverage: [],
        evaluatedAt: at('14:31'),
      }),
    {
      grade: 'OVER_SCOPE',
      ruleId: 'over_scope',
      state: 'FINAL',
      observationIds: [O1.id],
      reasons: [{ code: 'scope.type_not_allowed', params: { type: 'email.sent' } }, match(O1)],
    },
  ],
  [
    "over_allowlist: the claim's own address is not allowed",
    () =>
      run({
        claim: claimOf({ counterparty: 'lee@vendor.example' }),
        grant: grantOf({ counterpartyAllowlist: ['company.com'] }),
      }),
    {
      grade: 'OVER_SCOPE',
      ruleId: 'over_allowlist',
      state: 'FINAL',
      observationIds: [],
      reasons: [{ code: 'scope.counterparty_not_allowed', params: {} }, NONE],
    },
  ],
  [
    'over_ceiling: a claimed amount above the ceiling, with no receipt in sight',
    () => run({ claim: purchase({ amountCents: 6000, currency: 'USD' }), grant: CEILING, coverage: [] }),
    {
      grade: 'OVER_SCOPE',
      ruleId: 'over_ceiling',
      state: 'FINAL',
      observationIds: [],
      reasons: [{ code: 'ceiling.exceeded', params: { amountCents: 6000, ceilingCents: 5000 } }, NONE],
    },
  ],
  [
    'over_ceiling_cumulative: prior spend plus this claim above the ceiling',
    () =>
      run({
        claim: purchase({ amountCents: 2000, currency: 'USD' }),
        grant: CEILING,
        coverage: [],
        context: { priorSpendCents: 4000 },
      }),
    {
      grade: 'OVER_SCOPE',
      ruleId: 'over_ceiling_cumulative',
      state: 'FINAL',
      observationIds: [],
      reasons: [
        {
          code: 'ceiling.cumulative_exceeded',
          params: { priorSpendCents: 4000, amountCents: 2000, ceilingCents: 5000 },
        },
        NONE,
      ],
    },
  ],
  [
    'no_target: a calendar claim without targetAt is never scored',
    () =>
      run({
        claim: claimOf({ type: 'calendar.created' }),
        candidates: [obsOf({ type: 'calendar.created', source: 'gcal.event' })],
      }),
    {
      grade: 'UNVERIFIABLE',
      ruleId: 'no_target',
      state: 'FINAL',
      observationIds: [],
      reasons: [{ code: 'claim.no_target', params: {} }, NONE],
    },
  ],
  [
    'underspecified: "Done! I sent the email." is never matched on time alone',
    () => run({ claim: claimOf({}, ['counterparty', 'subjectHint']), candidates: [O1] }),
    {
      grade: 'UNVERIFIABLE',
      ruleId: 'underspecified',
      state: 'FINAL',
      observationIds: [],
      reasons: [{ code: 'claim.too_vague', params: {} }, NONE],
    },
  ],
  [
    'no_coverage: Gmail never synced over the window',
    () => run({ coverage: [] }),
    {
      grade: 'UNVERIFIABLE',
      ruleId: 'no_coverage',
      state: 'PENDING',
      observationIds: [],
      reasons: [{ code: 'coverage.none', params: SOURCE }, NONE],
    },
  ],
  [
    'verified: an exact match',
    () => run({ candidates: [O1] }),
    { grade: 'VERIFIED', ruleId: 'verified', state: 'FINAL', observationIds: [O1.id], reasons: [match(O1)] },
  ],
  [
    'partial: same domain, half the subject (S = 1/2)',
    () => run({ candidates: [obsOf({ counterparty: 'raj@company.com', subjectHint: 'Q3 budget' })] }),
    {
      grade: 'PARTIAL',
      ruleId: 'partial',
      state: 'FINAL',
      observationIds: [obsOf({ counterparty: 'raj@company.com', subjectHint: 'Q3 budget' }).id],
      reasons: [match(obsOf({ counterparty: 'raj@company.com', subjectHint: 'Q3 budget' }))],
    },
  ],
  [
    'pending: grace not elapsed; the receipt holds the UNVERIFIABLE placeholder',
    () => run({ coverage: [entry({ lastSyncAt: at('14:20'), windowEnd: at('14:20') })] }),
    {
      grade: 'UNVERIFIABLE',
      ruleId: 'pending',
      state: 'PENDING',
      observationIds: [],
      reasons: [{ code: 'grace.waiting', params: SOURCE }, NONE],
    },
  ],
  [
    'partial_coverage: grace elapsed but the window was not all seen',
    () => run({ coverage: [entry({ windowStart: at('14:10') })] }),
    {
      grade: 'UNVERIFIABLE',
      ruleId: 'partial_coverage',
      state: 'PENDING',
      observationIds: [],
      reasons: [{ code: 'coverage.partial', params: SOURCE }, NONE],
    },
  ],
  [
    'not_found: the whole window seen after grace, nothing matched',
    () => run({}),
    {
      grade: 'NOT_FOUND',
      ruleId: 'not_found',
      state: 'FINAL',
      observationIds: [],
      reasons: [{ code: 'coverage.account_unbound', params: SOURCE }, NONE],
    },
  ],
  [
    'default_unverifiable: no rule matched (a policy without not_found), FINAL after 24 h',
    () =>
      run({
        policy: loadPolicy(
          mergePatch(defaultPolicyJson, {
            rules: defaultPolicyJson.rules.filter((rule) => rule.id !== 'not_found'),
          }),
        ),
        evaluatedAt: at('14:03', '07'),
      }),
    { grade: 'UNVERIFIABLE', ruleId: TERMINAL_RULE_ID, state: 'FINAL', observationIds: [], reasons: [NONE] },
  ],
];

describe('every rule fires (§6.2, task 1.5 Done-when)', () => {
  it.each(CASES)('%s', (_name, grading, expected) => {
    const receipt = grading();
    expect({
      grade: receipt.grade,
      ruleId: receipt.ruleId,
      state: receipt.state,
      observationIds: receipt.observationIds,
      reasons: receipt.reasons,
    }).toEqual(expected);
  });

  it('the table names every rule of the default policy, plus the terminal rule', () => {
    const named = new Set(CASES.map(([, , expected]) => expected.ruleId));
    expect(named).toEqual(new Set([...DEFAULT_POLICY.rules.map((rule) => rule.id), TERMINAL_RULE_ID]));
  });

  it('a PENDING outcome is stored as UNVERIFIABLE with ruleId pending and confidence 0 (§2)', () => {
    const pending = run({ coverage: [entry({ lastSyncAt: at('14:20'), windowEnd: at('14:20') })] });
    expect([pending.grade, pending.ruleId, pending.confidence]).toEqual(['UNVERIFIABLE', 'pending', 0]);
  });

  it('first match wins: over-scope rules come before coverage, and claim-intrinsic rules before no_coverage', () => {
    const notAllowed = run({ grant: grantOf({ allowedTypes: [] }), coverage: [] });
    expect(notAllowed.ruleId).toBe('over_scope');
    const vagueCalendar = run({
      claim: claimOf({ type: 'calendar.created' }, ['counterparty', 'subjectHint']),
      coverage: [],
    });
    expect(vagueCalendar.ruleId).toBe('no_target');
  });
});
