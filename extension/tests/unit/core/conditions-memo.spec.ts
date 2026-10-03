/**
 * POL-2 (docs/grading.md §3 "the loaded, frozen policy", §6; Hard Rule 4): `firstMatch` remembers its per-rule
 * work only for the `rules` array of a policy `loadPolicy` returned (policy.ts `isLoadedRules`). Any other array is
 * read afresh on every call, so an in-place edit, or a frozen array whose rule reads its `when` through an accessor,
 * is never answered from a stale memo. Being frozen proves nothing: a getter on a frozen object can still change.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { evaluateConditions, firstMatch, type RuleWhen } from '../../../src/core/conditions';
import { DEFAULT_POLICY, isLoadedRules, loadPolicy, type PolicyRule } from '../../../src/core/policy';
import { buildClaim, buildCoverage, buildGrant } from '../../golden/build';
import { ScenarioClaim } from '../../golden/scenario-schema';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
const EVAL = at('15:00');

/** An email claim whose window [14:00, 14:48] is fully covered, grace elapsed: coverage is 'full'. */
const conditions = () =>
  evaluateConditions({
    claim: buildClaim(
      ScenarioClaim.parse({
        ref: 'c1',
        agent: 'muse',
        type: 'email.sent',
        counterparty: 'priya@company.com',
        claimedAt: at('14:02'),
      }),
    ),
    grant: buildGrant({ agent: 'muse' }, EVAL),
    policy: DEFAULT_POLICY,
    coverage: buildCoverage(
      [
        {
          source: 'gmail.sent',
          lastSyncAt: at('15:00'),
          windowStart: at('12:00'),
          windowEnd: at('15:00'),
          accountHash: 'acct-a',
        },
      ],
      EVAL,
    ),
    context: { priorSpendCents: 0 },
    bestScore: null,
    assigned: null,
  });

/** Frozen, as a loaded policy's are: a gate that tests freezing alone would memoise the accessor rule below. */
const NEVER: RuleWhen = Object.freeze({ coverage: 'none' });
const ALWAYS: RuleWhen = Object.freeze({ coverage: 'full' });

describe('isLoadedRules: only the rules array loadPolicy built', () => {
  it('is true for a loaded policy, false for a copy, a frozen copy or the document itself', () => {
    expect(isLoadedRules(DEFAULT_POLICY.rules)).toBe(true);
    expect(isLoadedRules(loadPolicy(defaultPolicyJson).rules)).toBe(true);
    expect(isLoadedRules([...DEFAULT_POLICY.rules])).toBe(false);
    expect(isLoadedRules(Object.freeze([...DEFAULT_POLICY.rules]))).toBe(false);
    expect(isLoadedRules(defaultPolicyJson.rules)).toBe(false);
    expect(isLoadedRules(DEFAULT_POLICY)).toBe(false);
  });
});

describe('firstMatch follows a rules array that is not a loaded policy’s', () => {
  it('a mutable array: an in-place edit of a when, and a pushed rule, are both seen', () => {
    const when: { coverage: 'none' | 'full' } = { coverage: 'none' };
    const rules: PolicyRule[] = [{ id: 'edited', when, then: 'UNVERIFIABLE' }];
    expect(firstMatch(rules, conditions())).toBeNull();
    when.coverage = 'full';
    expect(firstMatch(rules, conditions())?.id).toBe('edited');
    when.coverage = 'none';
    rules.push({ id: 'pushed', when: ALWAYS, then: 'UNVERIFIABLE' });
    expect(firstMatch(rules, conditions())?.id).toBe('pushed');
  });

  it('a frozen array whose frozen rule reads its when through an accessor', () => {
    let reads = 0;
    const rule: PolicyRule = Object.freeze(
      Object.defineProperty({ id: 'accessor', then: 'UNVERIFIABLE' as const }, 'when', {
        get: (): RuleWhen => (reads++ === 0 ? NEVER : ALWAYS),
        enumerable: true,
      }) as PolicyRule,
    );
    const rules = Object.freeze([rule]);
    expect([Object.isFrozen(rules), Object.isFrozen(rule)]).toEqual([true, true]);
    expect(firstMatch(rules, conditions())).toBeNull();
    expect(firstMatch(rules, conditions())?.id).toBe('accessor');
  });

  it('a loaded policy decides as its rules say, call after call', () => {
    const first = firstMatch(DEFAULT_POLICY.rules, conditions())?.id;
    expect(first).toBe('not_found');
    expect(firstMatch(DEFAULT_POLICY.rules, conditions())?.id).toBe(first);
  });
});
