/**
 * Claim-less `grade()` (docs/grading.md §8, v1.4): "A claim-less grade whose matched rule concludes anything but
 * UNASKED or OVER_SCOPE returns rule `default_unverifiable`, FINAL, subject `{k:'unasked', observationId:
 * candidates[0]}` (or `{k:'scope', …}` for a scope subject), `observationIds []`; `gradeBatch` never returns it.
 * A claim-less grade whose only orphan has `observedAt > evaluatedAt` throws `GradeError('claimless_subject')`."
 * With no claim there is no window, so a claim-less NOT_FOUND, VERIFIED, PARTIAL or PENDING would claim a sight
 * Attest never had (Hard Rule 5).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade, GradeError } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { receiptId } from '../../../src/core/receipt';
import { Attribution, type GradeContext, type Observation, Receipt } from '../../../src/core/schema';
import { buildCoverage, buildGrant, buildObservation, mergePatch, PolicyView } from '../../golden/build';
import { ScenarioObservation } from '../../golden/scenario-schema';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const VIEW = PolicyView.parse(defaultPolicyJson);
const GRANT = buildGrant({ agent: 'muse', declaredScopes: ['gmail.send'] }, EVAL);
const COVERAGE = buildCoverage(
  [
    {
      source: 'gmail.sent',
      lastSyncAt: EVAL,
      windowStart: at('12:00'),
      windowEnd: EVAL,
      accountHash: 'acct-a',
    },
  ],
  EVAL,
);
/** A likely attribution (7/10) and an unlikely one (1/100). */
const LIKELY = Attribution.parse({
  agent: 'muse',
  scoreBp: 7_000,
  signals: ['agentSessionActive', 'userIdle'],
});
const UNLIKELY = Attribution.parse({ agent: 'muse', scoreBp: 100, signals: ['agentSessionActive'] });

function orphanOf(over: Record<string, unknown> = {}): Observation {
  const base = {
    ref: 'o1',
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'vendor@supplier.example',
    subjectHint: 'Re: invoice',
    occurredAt: at('14:03'),
    observedAt: at('14:30'),
    ...over,
  };
  return buildObservation(ScenarioObservation.parse(base), [], EVAL, VIEW);
}

/** The default rules with `rule` first (and any default rule with its id left out). */
function policyWith(rule: { id: string; when: Record<string, unknown>; then: string }): Policy {
  const rules = [rule, ...defaultPolicyJson.rules.filter((r) => r.id !== rule.id)];
  return loadPolicy(mergePatch(defaultPolicyJson, { rules }));
}

function run(candidates: readonly Observation[], context: GradeContext, policy: Policy = DEFAULT_POLICY) {
  return Receipt.parse(grade(null, candidates, GRANT, policy, COVERAGE, context));
}

/** Everything §8 fixes about a claim-less terminal receipt. */
function expectTerminal(receipt: Receipt, id: string): void {
  expect(receipt).toMatchObject({
    id,
    agent: 'muse',
    observationIds: [],
    grade: 'UNVERIFIABLE',
    confidence: 0,
    ruleId: 'default_unverifiable',
    reasons: [],
    signals: {},
    state: 'FINAL',
    computedAt: EVAL,
    finalAt: EVAL,
  });
  expect(receipt.claimId).toBeUndefined();
  expect(receipt.attribution).toBeUndefined();
}

describe('§8: a claim-less rule concluding anything but UNASKED or OVER_SCOPE is the terminal rule', () => {
  const orphan = orphanOf();
  const unaskedId = receiptId({ k: 'unasked', observationId: orphan.id });
  const scopeId = receiptId({ k: 'scope', agent: 'muse', scope: 'gmail.read' });

  it.each(['NOT_FOUND', 'VERIFIED', 'PARTIAL', 'UNVERIFIABLE'])(
    'an orphan whose rule concludes %s: default_unverifiable, FINAL, subject {k:unasked}, no evidence',
    (then) => {
      const policy = policyWith({ id: 'quiet', when: { unaskedLikely: true }, then });
      expectTerminal(run([orphan], { priorSpendCents: 0, attribution: LIKELY }, policy), unaskedId);
    },
  );

  it('an orphan whose rule concludes PENDING (rule pending): never "checking", FINAL at once', () => {
    const policy = policyWith({ id: 'pending', when: { unaskedLikely: false }, then: 'PENDING' });
    expectTerminal(run([orphan], { priorSpendCents: 0, attribution: UNLIKELY }, policy), unaskedId);
  });

  it('an orphan no rule matches (the attribution is below the threshold): the same terminal receipt', () => {
    expectTerminal(run([orphan], { priorSpendCents: 0, attribution: UNLIKELY }), unaskedId);
    expectTerminal(run([orphan], { priorSpendCents: 0 }), unaskedId);
  });

  it.each(['NOT_FOUND', 'VERIFIED', 'UNVERIFIABLE'])(
    'an observed scope whose rule concludes %s: default_unverifiable, FINAL, subject {k:scope}',
    (then) => {
      const policy = policyWith({ id: 'quiet', when: { observedScopeExceedsDeclared: true }, then });
      expectTerminal(run([], { priorSpendCents: 0, scope: { observed: 'gmail.read' } }, policy), scopeId);
    },
  );

  it('a declared scope matches no shipped rule: the terminal receipt on the scope subject', () => {
    const declared = receiptId({ k: 'scope', agent: 'muse', scope: 'gmail.send' });
    expectTerminal(run([], { priorSpendCents: 0, scope: { observed: 'gmail.send' } }), declared);
  });

  it('UNASKED and OVER_SCOPE outcomes are kept: they are the claim-less receipts gradeBatch returns', () => {
    const unasked = run([orphan], { priorSpendCents: 0, attribution: LIKELY });
    expect([unasked.id, unasked.grade, unasked.ruleId, unasked.observationIds]).toEqual([
      unaskedId,
      'UNASKED',
      'unasked',
      [orphan.id],
    ]);
    const scope = run([], { priorSpendCents: 0, scope: { observed: 'gmail.read' } });
    expect([scope.id, scope.grade, scope.ruleId, scope.observationIds]).toEqual([
      scopeId,
      'OVER_SCOPE',
      'over_scope_observed',
      [],
    ]);
  });
});

describe('§8: the subject is candidates[0], the only orphan as of evaluatedAt', () => {
  it('the same observation seen twice is one subject (one id)', () => {
    const first = orphanOf();
    const again = orphanOf({ observedAt: at('14:45') });
    const context = { priorSpendCents: 0, attribution: LIKELY };
    expect(run([again, first], context).id).toBe(receiptId({ k: 'unasked', observationId: first.id }));
  });

  it('throws claimless_subject when the only orphan was first seen after evaluatedAt', () => {
    const late = orphanOf({ observedAt: '2026-10-06T15:00:00.001-04:00' });
    for (const attribution of [LIKELY, UNLIKELY]) {
      expect(() => run([late], { priorSpendCents: 0, attribution })).toThrow(
        new GradeError('claimless_subject'),
      );
    }
  });

  it('a scope subject with any observation is two subjects, even one first seen after evaluatedAt', () => {
    const scope = { priorSpendCents: 0, scope: { observed: 'gmail.read' } };
    const late = orphanOf({ observedAt: '2026-10-06T15:00:00.001-04:00' });
    for (const candidates of [[late], [orphanOf()]]) {
      expect(() => run(candidates, scope)).toThrow(new GradeError('claimless_subject'));
    }
    expect(run([], scope).grade).toBe('OVER_SCOPE');
  });

  it('an orphan first seen at evaluatedAt exactly is graded (§3: the bound is inclusive)', () => {
    const now = orphanOf({ observedAt: EVAL });
    expect(run([now], { priorSpendCents: 0, attribution: LIKELY }).grade).toBe('UNASKED');
  });

  it('a later sighting beside a visible one is ignored: the visible sighting is the subject', () => {
    const seen = orphanOf();
    const late = orphanOf({ observedAt: '2026-10-06T15:00:00.001-04:00' });
    expect(run([late, seen], { priorSpendCents: 0, attribution: LIKELY }).observationIds).toEqual([seen.id]);
  });
});
