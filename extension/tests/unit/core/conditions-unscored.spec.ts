/**
 * POL-1 (docs/grading.md §4.3, §5.2, §6, §6.1; Hard Rule 5): the score conditions `bestScoreGte` and `bestScoreLt`
 * are not applicable to a claim that is never scored against observations (underspecified, a calendar claim
 * without `targetAt`, a type with no sources). Otherwise "nothing matched at the partial threshold" is asserted of
 * a claim nothing was matched against, and a policy that tests `not_found` before `underspecified` (or drops
 * `underspecified`) grades "I've sent the Q3 deck" NOT_FOUND FINAL with the very email in full view.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { evaluateConditions } from '../../../src/core/conditions';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { Activity, type Claim, type Observation } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../../golden/scenario-schema';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
const EVAL = at('16:00');
const CONTEXT = { priorSpendCents: 0 };
const GRANT = buildGrant({ agent: 'muse' }, EVAL);
/** gmail.sent seen 09:00–15:55, synced 15:55: the window [14:00, 14:48] is fully covered and grace has elapsed. */
const COVERAGE = buildCoverage(
  [
    {
      source: 'gmail.sent',
      lastSyncAt: at('15:55'),
      windowStart: at('09:00'),
      windowEnd: at('15:55'),
      accountHash: 'acct-a',
    },
  ],
  EVAL,
);

const claimOf = (fields: Record<string, unknown>): Claim =>
  buildClaim(ScenarioClaim.parse({ ref: 'c1', agent: 'muse', claimedAt: at('14:02'), ...fields }));

/** "I've sent the Q3 deck.": no recipient, so no email.sent identity feature applies (§5.2). */
const VAGUE = claimOf({ type: 'email.sent', subjectHint: 'Q3 deck' });
/** The very email the agent sent, one minute after the claim. */
const SENT: Observation = buildObservation(
  ScenarioObservation.parse({
    ref: 'o1',
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    occurredAt: at('14:03'),
    observedAt: at('14:10'),
  }),
  [],
  EVAL,
  PolicyView.parse(defaultPolicyJson),
);

const RULES = defaultPolicyJson.rules;
const NOT_FOUND_RULE = RULES.find((rule) => rule.id === 'not_found');

/** The shipped rules with `not_found` moved to position `k`. */
function notFoundAt(k: number): Policy {
  if (NOT_FOUND_RULE === undefined) throw new Error('the shipped policy has a not_found rule');
  const rest = RULES.filter((rule) => rule.id !== 'not_found');
  return loadPolicy({ ...defaultPolicyJson, rules: [...rest.slice(0, k), NOT_FOUND_RULE, ...rest.slice(k)] });
}

const outcome = (policy: Policy, candidates: readonly Observation[]) => {
  const receipt = grade(VAGUE, candidates, GRANT, policy, COVERAGE, CONTEXT);
  return [receipt.grade, receipt.ruleId, receipt.state];
};

describe('score conditions apply only to a claim that is scored (§4.3, §6.1)', () => {
  const scores = (claim: Claim): (boolean | null)[] => {
    const facts = { claim, grant: GRANT, policy: DEFAULT_POLICY, coverage: COVERAGE, context: CONTEXT };
    const c = evaluateConditions({ ...facts, bestScore: null, assigned: null });
    return [
      c.bestScoreGte('partial'),
      c.bestScoreLt('partial'),
      c.bestScoreGte('verified'),
      c.bestScoreLt('verified'),
    ];
  };

  it('not applicable to an underspecified claim, a calendar claim without targetAt, or a type with no sources', () => {
    const calendar = claimOf({
      type: 'calendar.created',
      counterparty: 'priya@company.com',
      subjectHint: 'sync',
    });
    const message = claimOf({ type: 'message.sent', counterparty: 'priya@company.com' });
    for (const claim of [VAGUE, calendar, message]) expect(scores(claim)).toEqual([null, null, null, null]);
  });

  it('an assignable claim with no candidate: Gte is false and Lt true', () => {
    const specific = claimOf({
      type: 'email.sent',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
    });
    expect(scores(specific)).toEqual([false, true, false, true]);
  });
});

describe('whatever the rule order, a claim never scored is never NOT_FOUND (§5.2, §6; Hard Rule 5)', () => {
  it('the shipped order grades it underspecified', () => {
    expect(outcome(DEFAULT_POLICY, [SENT])).toEqual(['UNVERIFIABLE', 'underspecified', 'FINAL']);
  });

  it('not_found at every position, before or after underspecified, with and without its email', () => {
    for (let k = 0; k < RULES.length; k += 1) {
      const policy = notFoundAt(k);
      for (const candidates of [[SENT], []]) {
        expect(outcome(policy, candidates), `not_found at ${k}`).toEqual([
          'UNVERIFIABLE',
          'underspecified',
          'FINAL',
        ]);
      }
    }
  });

  it('with no underspecified rule at all, it falls through to default_unverifiable (pending until §8 finalises it)', () => {
    const policy = loadPolicy({
      ...defaultPolicyJson,
      rules: RULES.filter((rule) => rule.id !== 'underspecified'),
    });
    for (const candidates of [[SENT], []]) {
      expect(outcome(policy, candidates)).toEqual(['UNVERIFIABLE', 'default_unverifiable', 'PENDING']);
    }
  });

  it('gradeBatch agrees, with not_found first', async () => {
    const activity = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [] });
    const index = createMemoryIndex([SENT], 1);
    const out = await gradeBatch([VAGUE], index, [GRANT], notFoundAt(0), COVERAGE, activity);
    const receipt = out.find((held) => held.receipt.claimId === VAGUE.id)?.receipt;
    expect([receipt?.grade, receipt?.ruleId, receipt?.observationIds]).toEqual([
      'UNVERIFIABLE',
      'underspecified',
      [],
    ]);
  });
});
