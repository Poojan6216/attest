/**
 * Cross-field checks on a policy document (docs/grading.md §2, §5.1, §5.2, §5.3, §6.1): the rules a single field's
 * schema cannot see. Internal to the policy module; `./policy` runs them after the field-by-field parse.
 *
 * Every numeric comparison here is on integers (basis points, milliseconds), never on decimal weights (§5.3).
 * PURE: no I/O, no clock, no logging.
 */
import type { ConditionName, PolicyDocument, RuleOutcome } from './policy-schema';
import { ActionType } from './schema';
import { BASIS_POINTS, MS_PER_DAY, MS_PER_MINUTE } from './units';

export interface PolicyIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Basis points of a weight. Exact for a valid weight; for an invalid one (already reported by the field
 * schema) only an approximation, which is all a cross-check needs.
 */
function roundedBasisPoints(weight: number): number {
  return Math.round(weight * BASIS_POINTS);
}

/**
 * §5.1: time proximity is 1 within `toleranceMin` and falls to 0 at each window edge, so the tolerance
 * must be strictly inside every edge (the slope `edge − tolerance` is never 0 or negative).
 */
function windowIssues({ windows }: PolicyDocument): PolicyIssue[] {
  const toleranceMs = windows.toleranceMin * MS_PER_MINUTE;
  const edges: readonly (readonly [string, number])[] = [
    ['windows.beforeClaimMin', windows.beforeClaimMin * MS_PER_MINUTE],
    ['windows.afterClaimMin', windows.afterClaimMin * MS_PER_MINUTE],
    ['windows.calendarDays (in minutes)', windows.calendarDays * MS_PER_DAY],
  ];
  return edges
    .filter(([, edgeMs]) => toleranceMs >= edgeMs)
    .map(([edge]) => ({ path: ['windows', 'toleranceMin'], message: `must be < ${edge}` }));
}

/**
 * §2, §4.3: PARTIAL means some evidence matches, so the partial threshold must be above 0: at 0 a candidate that
 * matches nothing (score 0) would be assigned, named as the claim's evidence, kept from orphan detection and graded
 * PARTIAL, and NOT_FOUND could never be reached (Hard Rule 5). A score can be partial without being verified only
 * if the partial threshold is strictly lower.
 *
 * §7: likewise UNASKED names its evidence, the signals that fired, so its threshold must be above 0 too (at least
 * 1 bp): at 0 an attribution whose every fired signal weighs 0 (score 0) would still be "likely", a FINAL accusation
 * resting on nothing (Hard Rules 5, 7). At 1 bp or more, an UNASKED receipt needs a signal with a positive weight.
 */
function thresholdIssues({ thresholds, unasked }: PolicyDocument): PolicyIssue[] {
  const partial = roundedBasisPoints(thresholds.partial);
  const issues: PolicyIssue[] = [];
  if (partial === 0) issues.push({ path: ['thresholds', 'partial'], message: 'must be > 0' });
  if (!(partial < roundedBasisPoints(thresholds.verified))) {
    issues.push({ path: ['thresholds', 'partial'], message: 'must be < thresholds.verified' });
  }
  if (roundedBasisPoints(unasked.threshold) === 0) {
    issues.push({ path: ['unasked', 'threshold'], message: 'must be > 0' });
  }
  return issues;
}

/**
 * §5.2, §5.3: a type that lists features must give them a positive total weight (the score divides by it),
 * and its identity features must be among them with a weight above 0. A type with sources must name at least
 * one identity feature (v1.3). Identity decides that a claim is not underspecified, so every claim that can be
 * assigned then has Σw > 0 and a zero weight can never make a claim matchable on time alone.
 */
function featureIssues(doc: PolicyDocument): PolicyIssue[] {
  const { features, featuresByType, identityFeatures, sourcesByType } = doc;
  return ActionType.options.flatMap((type) => {
    const listed = featuresByType[type];
    const issues: PolicyIssue[] = [];
    const totalBasisPoints = listed.reduce((sum, feature) => sum + roundedBasisPoints(features[feature]), 0);
    if (listed.length > 0 && totalBasisPoints === 0) {
      issues.push({
        path: ['featuresByType', type],
        message: 'the weights of the listed features must sum to more than 0',
      });
    }
    if (sourcesByType[type].length > 0 && identityFeatures[type].length === 0) {
      issues.push({ path: ['identityFeatures', type], message: 'must not be empty for a type with sources' });
    }
    identityFeatures[type].forEach((feature, index) => {
      const path = ['identityFeatures', type, index];
      if (!listed.includes(feature)) {
        issues.push({ path, message: `"${feature}" is not listed in featuresByType["${type}"]` });
      }
      if (roundedBasisPoints(features[feature]) === 0) {
        issues.push({ path, message: `"${feature}" has weight 0 in features` });
      }
    });
    return issues;
  });
}

/** One piece of evidence a rule must test: at least one of `conditions` set to one of `values`. */
interface Evidence {
  readonly conditions: readonly ConditionName[];
  readonly values: readonly (string | boolean)[];
}

/**
 * §2, §6.1: the evidence a rule must name before it may conclude a grade that asserts something, whatever the
 * rule order (Hard Rule 5: UNVERIFIABLE beats a guess; Hard Rule 7: UNASKED only above the attribution
 * threshold). VERIFIED needs a match at the verified threshold and PARTIAL one at either threshold; NOT_FOUND
 * needs the whole window seen after grace with nothing at the partial threshold; OVER_SCOPE needs a fact outside
 * the grant. UNVERIFIABLE asserts nothing and PENDING is its placeholder (§2), so they need none. The shipped
 * rules name exactly these.
 */
const EVIDENCE: Readonly<Partial<Record<RuleOutcome, readonly Evidence[]>>> = {
  VERIFIED: [{ conditions: ['bestScoreGte'], values: ['verified'] }],
  PARTIAL: [{ conditions: ['bestScoreGte'], values: ['partial', 'verified'] }],
  NOT_FOUND: [
    { conditions: ['graceElapsed'], values: [true] },
    { conditions: ['coverage'], values: ['full'] },
    { conditions: ['bestScoreLt'], values: ['partial'] },
  ],
  UNASKED: [{ conditions: ['unaskedLikely'], values: [true] }],
  OVER_SCOPE: [
    {
      conditions: [
        'observedScopeExceedsDeclared',
        'typeNotInGrant',
        'counterpartyNotAllowed',
        'amountAboveCeiling',
        'cumulativeAboveCeiling',
      ],
      values: [true],
    },
  ],
};

function evidenceIssue(index: number, then: RuleOutcome, { conditions, values }: Evidence): PolicyIssue {
  const wanted = values.map((value) => JSON.stringify(value)).join(' or ');
  const [only] = conditions;
  if (conditions.length === 1 && only !== undefined) {
    return { path: ['rules', index, 'when', only], message: `must be ${wanted} when then is "${then}"` };
  }
  return {
    path: ['rules', index, 'when'],
    message: `must set one of ${conditions.join(', ')} to ${wanted} when then is "${then}"`,
  };
}

/** Each rule that concludes a grade without naming the evidence `EVIDENCE` lists for it, one issue per gap. */
function ruleIssues({ rules }: PolicyDocument): PolicyIssue[] {
  return rules.flatMap((rule, index) =>
    (EVIDENCE[rule.then] ?? [])
      .filter(({ conditions, values }) =>
        conditions.every((condition) => !values.some((value) => rule.when[condition] === value)),
      )
      .map((evidence) => evidenceIssue(index, rule.then, evidence)),
  );
}

/** Every cross-field problem in `doc`, in document order. Empty for a valid policy. */
export function policyIssues(doc: PolicyDocument): PolicyIssue[] {
  return [...windowIssues(doc), ...thresholdIssues(doc), ...featureIssues(doc), ...ruleIssues(doc)];
}
