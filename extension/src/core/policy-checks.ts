/**
 * Cross-field checks on a policy document (docs/grading.md §5.1, §5.2, §5.3): the rules a single field's
 * schema cannot see. Internal to the policy module; `./policy` runs them after the field-by-field parse.
 *
 * Every comparison here is on integers (basis points, milliseconds), never on decimal weights (§5.3).
 * PURE: no I/O, no clock, no logging.
 */
import type { PolicyDocument } from './policy-schema';
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

/** A score can be partial without being verified only if the partial threshold is strictly lower. */
function thresholdIssues({ thresholds }: PolicyDocument): PolicyIssue[] {
  if (roundedBasisPoints(thresholds.partial) < roundedBasisPoints(thresholds.verified)) return [];
  return [{ path: ['thresholds', 'partial'], message: 'must be < thresholds.verified' }];
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

/** Every cross-field problem in `doc`, in document order. Empty for a valid policy. */
export function policyIssues(doc: PolicyDocument): PolicyIssue[] {
  return [...windowIssues(doc), ...thresholdIssues(doc), ...featureIssues(doc)];
}
