/**
 * Task 1.5: `grade()` (docs/grading.md §3, §6.4, §8): what it sees, the best candidate, the receipt fields,
 * finality per outcome, purity, and the inputs it refuses (typed `GradeError`).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade, GradeError } from '../../../src/core/grade';
import { idFromHash, sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { ratio, toDisplay } from '../../../src/core/ratio';
import { inputsHash, receiptId } from '../../../src/core/receipt';
import {
  Attribution,
  type Claim,
  type GradeContext,
  type Grant,
  type Observation,
  Receipt,
  Ulid,
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
  return grade(
    call.claim === undefined ? claimOf() : call.claim,
    call.candidates ?? [],
    call.grant ?? grantOf(),
    call.policy ?? DEFAULT_POLICY,
    buildCoverage(call.coverage ?? [entry()], call.evaluatedAt ?? EVAL),
    call.context ?? { priorSpendCents: 0 },
  );
}

const attribution = (over: Record<string, unknown> = {}) =>
  Attribution.parse({ agent: 'muse', scoreBp: 7000, signals: ['agentSessionActive', 'userIdle'], ...over });
const raj = obsOf({ ref: 'o2', counterparty: 'raj@company.com', subjectHint: 'Q3 budget' });

describe('what grade() sees (§3)', () => {
  it('ignores coverage synced and candidates observed after evaluatedAt, as if they were absent', () => {
    const future = '2026-10-06T15:00:00.001-04:00';
    const late = obsOf({ observedAt: future });
    const withFuture = run({
      candidates: [late],
      coverage: [entry(), entry({ lastSyncAt: future, accountHash: 'acct-b' })],
    });
    expect(withFuture).toEqual(run({}));
    expect(withFuture.grade).toBe('NOT_FOUND');
  });

  it('does not depend on candidate order or repetition', () => {
    const exact = obsOf();
    expect(run({ candidates: [raj, exact, raj] })).toEqual(run({ candidates: [exact, raj] }));
  });

  it('the best candidate is the highest exact score; equal scores go to the lower observation id', () => {
    const a = obsOf({
      ref: 'o3',
      counterparty: 'raj@company.com',
      subjectHint: 'Q3 budget',
      occurredAt: at('14:03'),
    });
    const b = obsOf({
      ref: 'o4',
      counterparty: 'lee@company.com',
      subjectHint: 'Q3 budget',
      occurredAt: at('14:02'),
    });
    const lower = a.id < b.id ? a : b;
    for (const candidates of [
      [a, b],
      [b, a],
    ]) {
      const receipt = run({ candidates });
      expect(receipt.reasons.find((r) => r.code === 'match.best')?.params).toEqual({
        observationId: lower.id,
      });
      expect(receipt.observationIds).toEqual([lower.id]);
    }
  });

  it('names a best candidate below partial without assigning it (§8)', () => {
    const weak = obsOf({ counterparty: 'lee@other.example', subjectHint: 'Hiring' });
    const receipt = run({ candidates: [weak] });
    expect([receipt.grade, receipt.observationIds, receipt.reasons.map((r) => r.code)]).toEqual([
      'NOT_FOUND',
      [],
      ['coverage.account_unbound', 'match.best'],
    ]);
  });
});

describe('receipt fields (§3, §6.4, §8)', () => {
  it('id from the subject, computedAt = evaluatedAt, policyHash and inputsHash, agent and claimId', () => {
    const claim = claimOf();
    const receipt = run({ candidates: [obsOf()] });
    expect(receipt).toMatchObject({
      id: receiptId({ k: 'claim', claimId: claim.id }),
      agent: 'muse',
      claimId: claim.id,
      computedAt: EVAL,
      finalAt: EVAL,
      policyHash: DEFAULT_POLICY.policyHash,
    });
    const coverage = buildCoverage([entry()], EVAL);
    const hash = inputsHash({
      claim,
      candidates: [obsOf()],
      grant: grantOf(),
      policyHash: DEFAULT_POLICY.policyHash,
      coverage,
      context: { priorSpendCents: 0 },
    });
    expect(receipt.inputsHash).toBe(hash);
    expect(Receipt.parse(receipt)).toEqual(receipt);
  });

  it('confidence: the best score for VERIFIED/PARTIAL, 1 for NOT_FOUND and OVER_SCOPE, the attribution for UNASKED, 0 otherwise', () => {
    expect(run({ candidates: [obsOf()] }).confidence).toBe(1);
    expect(run({ candidates: [raj] }).confidence).toBe(toDisplay(ratio(1, 2)));
    expect(run({}).confidence).toBe(1);
    expect(run({ grant: grantOf({ allowedTypes: [] }) }).confidence).toBe(1);
    expect(
      run({ claim: null, candidates: [obsOf()], context: { priorSpendCents: 0, attribution: attribution() } })
        .confidence,
    ).toBe(0.7);
    expect(run({ coverage: [] }).confidence).toBe(0);
  });

  it('signals: the applicable features and score of the best candidate, none without one', () => {
    expect(run({ candidates: [raj] }).signals).toEqual({
      timeProximity: 1,
      counterpartyExact: 0,
      counterpartyDomain: 1,
      subjectOverlap: toDisplay(ratio(1, 3)),
      score: 0.5,
    });
    expect(run({}).signals).toEqual({});
  });
});

describe('receipt fields: request and claim-less subjects (§3, §8)', () => {
  it('carries the claim requestId', () => {
    const requestId = Ulid.parse(idFromHash(sha256Hex('request')));
    expect(run({ claim: { ...claimOf(), requestId } }).requestId).toBe(requestId);
  });

  it('UNASKED: subject {k:unasked}, attribution likely, its orphan as evidence, no claimId', () => {
    const orphan = obsOf();
    const receipt = run({
      claim: null,
      candidates: [orphan],
      context: { priorSpendCents: 0, attribution: attribution() },
    });
    expect(receipt).toMatchObject({
      id: receiptId({ k: 'unasked', observationId: orphan.id }),
      grade: 'UNASKED',
      attribution: 'likely',
      observationIds: [orphan.id],
      signals: {},
    });
    expect('claimId' in receipt).toBe(false);
  });

  it('a scope-diff receipt: subject {k:scope, agent, scope}, no evidence', () => {
    const receipt = run({ claim: null, context: { priorSpendCents: 0, scope: { observed: 'gmail.read' } } });
    expect(receipt).toMatchObject({
      id: receiptId({ k: 'scope', agent: 'muse', scope: 'gmail.read' }),
      grade: 'OVER_SCOPE',
      observationIds: [],
      confidence: 1,
    });
  });
});

describe('finality through grade() (§8)', () => {
  it('VERIFIED is FINAL once synced at end + graceMin; PARTIAL waits for end + afterClaimMin', () => {
    const early = [entry({ lastSyncAt: at('14:40'), windowEnd: at('14:40') })];
    expect(run({ candidates: [obsOf()], coverage: early, evaluatedAt: at('14:40') }).state).toBe('FINAL');
    expect(run({ candidates: [raj], coverage: early, evaluatedAt: at('14:40') }).state).toBe('PENDING');
  });

  it("OVER_SCOPE from the candidate's address waits for grace; from the claim's own address it is FINAL", () => {
    const allowlist = grantOf({ counterpartyAllowlist: ['priya@company.com'] });
    const early = [entry({ lastSyncAt: at('14:40'), windowEnd: at('14:40') })];
    const byEvidence = run({
      candidates: [raj],
      grant: allowlist,
      coverage: early,
      evaluatedAt: at('14:40'),
    });
    expect([byEvidence.ruleId, byEvidence.state, byEvidence.observationIds]).toEqual([
      'over_allowlist',
      'PENDING',
      [raj.id],
    ]);
    const byClaim = run({
      claim: claimOf({ counterparty: 'lee@vendor.example' }),
      grant: allowlist,
      coverage: early,
      evaluatedAt: at('14:40'),
    });
    expect([byClaim.ruleId, byClaim.state]).toEqual(['over_allowlist', 'FINAL']);
  });

  it('UNASKED stays PENDING until the agent adapter synced past occurredAt + beforeClaimMin + graceMin', () => {
    const orphan = obsOf();
    const unasked = (adapterLastSyncAt: string) =>
      run({
        claim: null,
        candidates: [orphan],
        context: { priorSpendCents: 0, attribution: attribution({ adapterLastSyncAt }) },
      });
    expect(unasked(at('14:34')).state).toBe('FINAL');
    expect(unasked(at('14:33')).state).toBe('PENDING');
  });
});

describe('purity and refusals', () => {
  it('never mutates its inputs (deep-frozen inputs grade the same)', () => {
    const freeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    };
    const claim = freeze(claimOf());
    const candidates = freeze([raj, obsOf()]);
    const coverage = freeze(buildCoverage([entry()], EVAL));
    const grant = freeze(grantOf({ counterpartyAllowlist: ['company.com'] }));
    const context = freeze({ priorSpendCents: 0 });
    const first = grade(claim, candidates, grant, DEFAULT_POLICY, coverage, context);
    expect(grade(claim, candidates, grant, DEFAULT_POLICY, coverage, context)).toEqual(first);
  });

  it("refuses a grant that is not the claim's or the attributed agent's", () => {
    expect(() => run({ grant: buildGrant({ agent: 'claude' }, EVAL) })).toThrow(
      new GradeError('agent_mismatch'),
    );
    const other = { priorSpendCents: 0, attribution: attribution({ agent: 'claude' }) };
    expect(() => run({ claim: null, candidates: [obsOf()], context: other })).toThrow(
      new GradeError('agent_mismatch'),
    );
  });

  it('refuses a claim-less grade without exactly one subject', () => {
    const bad: readonly Call[] = [
      { claim: null },
      { claim: null, candidates: [obsOf(), raj] },
      {
        claim: null,
        candidates: [obsOf()],
        context: { priorSpendCents: 0, scope: { observed: 'gmail.read' } },
      },
      { claim: null, candidates: [obsOf({ observedAt: '2026-10-06T15:00:00.001-04:00' })] },
    ];
    for (const call of bad) expect(() => run(call)).toThrow(new GradeError('claimless_subject'));
  });

  it('refuses a policy rule that would make a claim receipt UNASKED, or an UNASKED without an orphan', () => {
    const rules = [{ id: 'odd', when: { coverage: 'full' }, then: 'UNASKED' }, ...defaultPolicyJson.rules];
    const odd = loadPolicy(mergePatch(defaultPolicyJson, { rules }));
    expect(() => run({ policy: odd })).toThrow(new GradeError('unasked_with_claim'));
    const scopeRules = [
      { id: 'odd', when: { observedScopeExceedsDeclared: true }, then: 'UNASKED' },
      ...defaultPolicyJson.rules,
    ];
    const scoped = { priorSpendCents: 0, scope: { observed: 'gmail.read' } };
    expect(() =>
      run({
        claim: null,
        context: scoped,
        policy: loadPolicy(mergePatch(defaultPolicyJson, { rules: scopeRules })),
      }),
    ).toThrow(new GradeError('claimless_subject'));
  });
});
