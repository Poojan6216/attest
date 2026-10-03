/**
 * POL-3 (docs/grading.md §2, §4.3, §5.3; Hard Rule 5): `thresholds.partial` must be above 0 basis points. PARTIAL
 * means some evidence matches; at 0 an observation that matches nothing (score 0) would be assigned, named as the
 * claim's evidence, kept from orphan detection and graded PARTIAL FINAL, and NOT_FOUND could never be reached. The
 * loader refuses it at `thresholds.partial`; one basis point is the smallest partial threshold that loads.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy, type Policy, PolicyError } from '../../../src/core/policy';
import type { Observation } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../../golden/scenario-schema';

const withPartial = (partial: number): unknown => ({
  ...structuredClone(defaultPolicyJson),
  thresholds: { ...defaultPolicyJson.thresholds, partial },
});

function issuesOf(raw: unknown): readonly string[] {
  try {
    loadPolicy(raw);
  } catch (error) {
    if (error instanceof PolicyError) return error.issues;
    throw error;
  }
  return [];
}

const ABOVE_ZERO = 'thresholds.partial: must be > 0';

describe('loadPolicy: thresholds.partial is above 0 basis points', () => {
  it('refuses 0, -0, and a value that rounds to 0 basis points, at thresholds.partial', () => {
    expect(issuesOf(withPartial(0))).toEqual([ABOVE_ZERO]);
    expect(issuesOf(withPartial(-0))).toEqual([ABOVE_ZERO]);
    expect(issuesOf(withPartial(0.00004))).toEqual([
      'thresholds.partial: must be a multiple of 0.0001',
      ABOVE_ZERO,
    ]);
  });

  it('loads one basis point, the smallest partial threshold', () => {
    expect(issuesOf(withPartial(0.0001))).toEqual([]);
    expect(loadPolicy(withPartial(0.0001)).bp.thresholds.partial).toBe(1);
  });
});

describe('a candidate that matches nothing is never evidence (§2, §4.3)', () => {
  const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
  const EVAL = at('16:00');
  const claim = buildClaim(
    ScenarioClaim.parse({
      ref: 'c1',
      agent: 'muse',
      type: 'email.sent',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
      claimedAt: at('14:02'),
    }),
  );
  /** Another person, another subject, at the window's far edge: every feature is 0. */
  const unrelated: Observation = buildObservation(
    ScenarioObservation.parse({
      ref: 'o1',
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: 'bob@elsewhere.org',
      subjectHint: 'lunch friday',
      occurredAt: at('14:48'),
      observedAt: at('14:50'),
    }),
    [],
    EVAL,
    PolicyView.parse(defaultPolicyJson),
  );
  const coverage = buildCoverage(
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
  const graded = (policy: Policy) => {
    const receipt = grade(claim, [unrelated], buildGrant({ agent: 'muse' }, EVAL), policy, coverage, {
      priorSpendCents: 0,
    });
    return [receipt.grade, receipt.ruleId, receipt.observationIds, receipt.signals.score];
  };

  it('scores 0, so it is NOT_FOUND under the shipped threshold and under the smallest one that loads', () => {
    expect(graded(DEFAULT_POLICY)).toEqual(['NOT_FOUND', 'not_found', [], 0]);
    expect(graded(loadPolicy(withPartial(0.0001)))).toEqual(['NOT_FOUND', 'not_found', [], 0]);
  });
});
