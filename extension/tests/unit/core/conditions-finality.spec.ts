/**
 * Task 1.5: `isFinalizable`, the §8 finality table, one row at a time (docs/grading.md §7, §8).
 *
 * The claim is an email at 14:02 (unit end 14:03): VERIFIED needs a sync ≥ 14:33 (end + graceMin), PARTIAL and
 * NOT_FOUND need ≥ 14:48 (end + afterClaimMin), the coverage-based UNVERIFIABLE and PENDING outcomes need
 * evaluatedAt ≥ 10-07 14:03 (end + finalizeUnverifiableHours).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { type FinalityInput, isFinalizable } from '../../../src/core/conditions';
import { GradeError } from '../../../src/core/grade';
import { DEFAULT_POLICY, type PolicyRule, type RuleOutcome } from '../../../src/core/policy';
import { Attribution, type Claim, type Coverage, type GradeContext } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const CLAIM = buildClaim({
  ref: 'c1',
  agent: 'muse',
  type: 'email.sent',
  counterparty: 'priya@company.com',
  claimedAt: at('14:02'),
});
const ORPHAN = buildObservation(
  {
    ref: 'o1',
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'x@y.example',
    occurredAt: at('14:00'),
  },
  [],
  at('14:10'),
  PolicyView.parse(defaultPolicyJson),
);

function coverageAt(lastSync: string, evaluatedAt = lastSync): Coverage {
  const entry = {
    source: 'gmail.sent' as const,
    lastSyncAt: lastSync,
    windowStart: at('12:00'),
    windowEnd: lastSync,
  };
  return buildCoverage([{ ...entry, accountHash: 'acct-a' }], evaluatedAt);
}

function rule(id: string, when: PolicyRule['when'], then: RuleOutcome): PolicyRule {
  return { id, when, then };
}

function input(over: Partial<FinalityInput>): FinalityInput {
  return {
    outcome: 'VERIFIED',
    rule: rule('verified', { bestScoreGte: 'verified' }, 'VERIFIED'),
    claim: CLAIM,
    orphan: null,
    grant: buildGrant({ agent: 'muse' }, at('15:00')),
    coverage: coverageAt(at('15:00')),
    context: { priorSpendCents: 0 },
    policy: DEFAULT_POLICY,
    candidateDependent: false,
    ...over,
  };
}

const final = (over: Partial<FinalityInput>): boolean => isFinalizable(input(over)).final;

describe('isFinalizable (§8)', () => {
  it('reports finalAt = evaluatedAt exactly when final', () => {
    expect(isFinalizable(input({}))).toEqual({ final: true, finalAt: at('15:00') });
    expect(isFinalizable(input({ coverage: coverageAt(at('14:20')) }))).toEqual({ final: false });
  });

  it('VERIFIED: every relevant source synced at end + graceMin (14:33), inclusive', () => {
    expect(final({ coverage: coverageAt(at('14:33')) })).toBe(true);
    expect(final({ coverage: coverageAt('2026-10-06T14:32:59.999-04:00') })).toBe(false);
  });

  it('PARTIAL and NOT_FOUND: graceElapsed, so also end + afterClaimMin (14:48)', () => {
    for (const outcome of ['PARTIAL', 'NOT_FOUND'] as const) {
      expect(final({ outcome, coverage: coverageAt(at('14:33')) })).toBe(false);
      expect(final({ outcome, coverage: coverageAt(at('14:48')) })).toBe(true);
    }
  });

  it('OVER_SCOPE: at once from claim-only facts; like PARTIAL when it depended on the candidate', () => {
    const early = coverageAt(at('14:10'));
    const scope = rule('over_allowlist', { counterpartyNotAllowed: true }, 'OVER_SCOPE');
    expect(final({ outcome: 'OVER_SCOPE', rule: scope, coverage: early })).toBe(true);
    expect(final({ outcome: 'OVER_SCOPE', rule: scope, coverage: early, candidateDependent: true })).toBe(
      false,
    );
    expect(
      final({
        outcome: 'OVER_SCOPE',
        rule: scope,
        coverage: coverageAt(at('14:48')),
        candidateDependent: true,
      }),
    ).toBe(true);
  });
});

describe('isFinalizable: UNVERIFIABLE and PENDING (§8)', () => {
  it('UNVERIFIABLE by a claim-intrinsic rule (no_target, underspecified): at once', () => {
    const early = coverageAt(at('14:10'));
    const noTarget = rule('no_target', { targetMissing: true }, 'UNVERIFIABLE');
    const vague = rule('underspecified', { underspecified: true }, 'UNVERIFIABLE');
    expect(final({ outcome: 'UNVERIFIABLE', rule: noTarget, coverage: early })).toBe(true);
    expect(final({ outcome: 'UNVERIFIABLE', rule: vague, coverage: early })).toBe(true);
  });

  it('UNVERIFIABLE for a type with no sources: at once', () => {
    const message = buildClaim({ ref: 'c2', agent: 'muse', type: 'message.sent', claimedAt: at('14:02') });
    const none = rule('no_coverage', { coverage: 'none' }, 'UNVERIFIABLE');
    expect(
      final({ outcome: 'UNVERIFIABLE', rule: none, claim: message, coverage: coverageAt(at('14:10')) }),
    ).toBe(true);
  });

  it('no_coverage, partial_coverage, default_unverifiable and pending: at end + finalizeUnverifiableHours', () => {
    const rules: [RuleOutcome, PolicyRule | null][] = [
      ['UNVERIFIABLE', rule('no_coverage', { coverage: 'none' }, 'UNVERIFIABLE')],
      [
        'UNVERIFIABLE',
        rule('partial_coverage', { coverage: 'partial', bestScoreLt: 'partial' }, 'UNVERIFIABLE'),
      ],
      ['UNVERIFIABLE', null],
      ['PENDING', rule('pending', { graceElapsed: false }, 'PENDING')],
    ];
    for (const [outcome, matched] of rules) {
      const sync = at('14:20');
      expect(final({ outcome, rule: matched, coverage: coverageAt(sync, at('14:02', '07')) })).toBe(false);
      expect(final({ outcome, rule: matched, coverage: coverageAt(sync, at('14:03', '07')) })).toBe(true);
    }
  });
});

describe('isFinalizable: claim-less outcomes and refusals (§7, §8)', () => {
  it('UNASKED: the attributed adapter synced at occurredAt + beforeClaimMin + graceMin, or 24 h passed', () => {
    const context = (adapterLastSyncAt?: string): GradeContext => ({
      priorSpendCents: 0,
      attribution: Attribution.parse({
        agent: 'muse',
        scoreBp: 7000,
        signals: ['agentSessionActive', 'userIdle'],
        ...(adapterLastSyncAt === undefined ? {} : { adapterLastSyncAt }),
      }),
    });
    const unasked = (c: GradeContext, evaluatedAt: string) =>
      final({
        outcome: 'UNASKED',
        claim: null,
        orphan: ORPHAN,
        context: c,
        coverage: coverageAt(at('14:10'), evaluatedAt),
      });
    expect(unasked(context(at('14:32')), at('15:00'))).toBe(true);
    expect(unasked(context('2026-10-06T14:31:59.999-04:00'), at('15:00'))).toBe(false);
    expect(unasked(context(), at('14:00', '07'))).toBe(true);
    expect(unasked(context(), '2026-10-07T13:59:59.999-04:00')).toBe(false);
  });

  it('every other claim-less outcome is final at once', () => {
    const scope = rule('over_scope_observed', { observedScopeExceedsDeclared: true }, 'OVER_SCOPE');
    expect(
      final({ outcome: 'OVER_SCOPE', rule: scope, claim: null, coverage: coverageAt(at('14:10')) }),
    ).toBe(true);
    expect(
      final({ outcome: 'UNVERIFIABLE', rule: null, claim: null, coverage: coverageAt(at('14:10')) }),
    ).toBe(true);
  });

  it('fails loud for an UNASKED with a claim or without its orphan', () => {
    expect(() => isFinalizable(input({ outcome: 'UNASKED' }))).toThrow(new GradeError('unasked_with_claim'));
    expect(() => isFinalizable(input({ outcome: 'UNASKED', claim: null }))).toThrow(GradeError);
  });

  it('a claim whose window was seen counts only what the account binding admits', () => {
    const bound = buildGrant({ agent: 'muse', accounts: { 'gmail.sent': ['acct-b'] } }, at('15:00'));
    expect(final({ grant: bound })).toBe(false);
    const claim: Claim = CLAIM;
    expect(final({ claim })).toBe(true);
  });
});
