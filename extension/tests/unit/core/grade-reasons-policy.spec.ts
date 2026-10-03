/**
 * Reason emission under a policy whose `pending` rule is not the shipped `{ graceElapsed: false }` (docs/grading.md
 * §15 Emission: "in general a rule's own codes are those of the conditions its `when` names that held, cap codes
 * accompany `coverage: 'partial'` and `grace.waiting` accompanies `graceElapsed: false` while PENDING"; QA Sprint 1
 * review). With the shipped rules `pending` always names `graceElapsed: false`, so a mutant that emits
 * `grace.waiting` for any PENDING outcome survived the whole suite. These cases pin the general rule.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { type Claim, type Coverage, Receipt } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, mergePatch } from '../../golden/build';
import { ScenarioClaim } from '../../golden/scenario-schema';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const GRANT = buildGrant({ agent: 'muse' }, EVAL);
const SOURCE = { source: 'gmail.sent' } as const;

const CLAIM: Claim = buildClaim(
  ScenarioClaim.parse({
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    claimedAt: at('14:02'),
  }),
);

/**
 * Gmail Sent seen over [12:00, 14:30] and synced at 14:30: the claim window [14:00, 14:48] is partly covered and
 * grace (a sync at or after 14:48) has not elapsed. `evaluatedAt` decides whether the outcome is old enough to
 * finalise by time (end 14:03 + finalizeUnverifiableHours 24 = 14:03 the next day).
 */
function partlySeen(evaluatedAt: string = EVAL, withAccount = true): Coverage {
  const entry = { ...SOURCE, lastSyncAt: at('14:30'), windowStart: at('12:00'), windowEnd: at('14:30') };
  return buildCoverage([withAccount ? { ...entry, accountHash: 'acct-a' } : entry], evaluatedAt);
}

/** The shipped policy with the `pending` rule's `when` replaced (id and `then: PENDING` kept). */
function pendingWhen(when: Record<string, unknown>): Policy {
  const rules = defaultPolicyJson.rules.map((rule) => (rule.id === 'pending' ? { ...rule, when } : rule));
  return loadPolicy(mergePatch(defaultPolicyJson, { rules }));
}

function run(policy: Policy, coverage: Coverage = partlySeen()): Receipt {
  return Receipt.parse(grade(CLAIM, [], GRANT, policy, coverage, { priorSpendCents: 0 }));
}

const summary = (receipt: Receipt) => [receipt.grade, receipt.ruleId, receipt.state];

describe('§15: grace.waiting accompanies graceElapsed: false while PENDING, and only then', () => {
  it('the shipped pending rule: grace.waiting for the source still waiting', () => {
    const receipt = run(DEFAULT_POLICY);
    expect(summary(receipt)).toEqual(['UNVERIFIABLE', 'pending', 'PENDING']);
    expect(receipt.reasons).toEqual([
      { code: 'grace.waiting', params: SOURCE },
      { code: 'match.none', params: {} },
    ]);
  });

  it('a pending rule naming only coverage: partial gives coverage.partial, never grace.waiting', () => {
    const receipt = run(pendingWhen({ coverage: 'partial' }));
    expect(summary(receipt)).toEqual(['UNVERIFIABLE', 'pending', 'PENDING']);
    expect(receipt.reasons).toEqual([
      { code: 'coverage.partial', params: SOURCE },
      { code: 'match.none', params: {} },
    ]);
  });

  it('a pending rule naming both gives both, in §15 table order', () => {
    const receipt = run(pendingWhen({ coverage: 'partial', graceElapsed: false }));
    expect(summary(receipt)).toEqual(['UNVERIFIABLE', 'pending', 'PENDING']);
    expect(receipt.reasons.map((reason) => reason.code)).toEqual([
      'coverage.partial',
      'grace.waiting',
      'match.none',
    ]);
  });

  it('cap codes accompany coverage: partial on a custom pending rule (an entry with no account)', () => {
    const receipt = run(pendingWhen({ coverage: 'partial' }), partlySeen(EVAL, false));
    expect(receipt.reasons).toEqual([
      { code: 'coverage.partial', params: SOURCE },
      { code: 'coverage.no_account', params: SOURCE },
      { code: 'match.none', params: {} },
    ]);
  });

  it('once finalised by time, coverage.never_completed replaces the waiting codes under either rule', () => {
    const late = partlySeen(at('14:03', '07'));
    for (const policy of [DEFAULT_POLICY, pendingWhen({ coverage: 'partial' })]) {
      const receipt = run(policy, late);
      expect(summary(receipt)).toEqual(['UNVERIFIABLE', 'pending', 'FINAL']);
      expect(receipt.reasons.map((reason) => reason.code)).not.toContain('grace.waiting');
      expect(receipt.reasons.map((reason) => reason.code)).toContain('coverage.never_completed');
    }
  });
});
