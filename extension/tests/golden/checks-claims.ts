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

/** §6.1: a purchase-like type is one whose only source is the receipt observer. */
export function receiptOnlyType(type: string, policy: PolicyView): boolean {
  const sources = policy.sourcesByType?.[type] ?? [];
  return sources.length === 1 && sources[0] === 'gmail.receipt';
}

/**
 * §6.1 (v1.3): a purchase-like claim with no counterparty, or whose normalised counterparty is not in
 * `policy.receiptMerchants`, has no parser: its coverage is at most partial (reason coverage.no_parser). The
 * files keep merchant names to plain ASCII words, so lowercasing and collapsing spaces is the whole of name().
 */
export function hasNoParser(claim: ScenarioClaim, policy: PolicyView): boolean {
  if (!receiptOnlyType(claim.type, policy)) return false;
  if (claim.counterparty === undefined) return true;
  const normalised = claim.counterparty.toLowerCase().split(/\s+/u).filter(Boolean).join(' ');
  return !(policy.receiptMerchants ?? []).includes(normalised);
}

/**
 * §6.1 / §15 (v1.3): a claim no parser can see is never NOT_FOUND (Hard Rule 5), and a `partial_coverage`
 * receipt names `coverage.no_parser` exactly when the claim has no parser (the emission table already keeps the
 * code off every other rule).
 */
export function noParserProblems(scenario: Scenario, policy: PolicyView): string[] {
  const problems: string[] = [];
  for (const e of scenario.expect.filter((x) => subjectKind(x) === 'claim')) {
    const claim = scenario.input.claims.find((c) => c.ref === e.ref);
    if (claim === undefined) continue;
    const noParser = hasNoParser(claim, policy);
    if (noParser && e.grade === 'NOT_FOUND') problems.push(`${claim.ref}: no parser, so never NOT_FOUND`);
    const named = e.reasonCodes.includes('coverage.no_parser');
    if (e.ruleId === 'partial_coverage' && named !== noParser)
      problems.push(`${claim.ref}: coverage.no_parser must be ${String(noParser)}`);
    if (named && !noParser) problems.push(`${claim.ref}: coverage.no_parser on a claim a parser covers`);
  }
  return problems;
}
