/**
 * Claim-receipt rules that need the claim and the observations, not only the expectation (docs/grading.md
 * §4.1, §4.3). Like checks.ts, every function returns the problems it found in the scenario files themselves
 * ([] = consistent with the contract); no core code runs here.
 */
import { type PolicyView } from './build';
import { subjectKind } from './checks';
import { type ExpectedReceipt, type Scenario, type ScenarioClaim } from './scenario-schema';

/**
 * §4.3: an underspecified claim, a calendar claim without targetAt, or a claim whose type has no sources is
 * never scored against observations, so its receipt has no score, no match.best and no evidence.
 */
function neverScored(claim: ScenarioClaim, e: ExpectedReceipt, policy: PolicyView): boolean {
  const noTarget = claim.type.startsWith('calendar.') && claim.targetAt === undefined;
  const noSources = (policy.sourcesByType?.[claim.type] ?? []).length === 0;
  return e.ruleId === 'underspecified' || e.ruleId === 'no_target' || noTarget || noSources;
}

/** §4.1: a candidate is an observation of the claim's own ActionType; evidence and match.best name one. */
function evidenceTypeProblems(scenario: Scenario, claim: ScenarioClaim, e: ExpectedReceipt): string[] {
  const best = e.reasonParams?.['match.best']?.observationId;
  const named = [...e.observationRefs, ...(typeof best === 'string' ? [best] : [])];
  return named.flatMap((ref) => {
    const observation = scenario.input.observations.find((o) => o.ref === ref);
    return observation?.type === claim.type ? [] : [`${ref} is not a ${claim.type} observation`];
  });
}

export function claimProblems(scenario: Scenario, policy: PolicyView): string[] {
  const problems: string[] = [];
  for (const e of scenario.expect.filter((x) => subjectKind(x) === 'claim')) {
    const claim = scenario.input.claims.find((c) => c.ref === e.ref);
    if (claim === undefined) continue;
    const scored = e.score !== null || e.observationRefs.length > 0 || e.reasonCodes.includes('match.best');
    if (neverScored(claim, e, policy) && scored) problems.push(`${claim.ref}: this claim is never scored`);
    problems.push(...evidenceTypeProblems(scenario, claim, e).map((problem) => `${claim.ref}: ${problem}`));
  }
  return problems;
}
