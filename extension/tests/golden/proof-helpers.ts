/**
 * Shared pieces of the `contract:<tag>` proofs (v12-rules.ts, v13-rules.ts, v13-rules-evidence.ts): each proof
 * reads one scenario file and its patched policy and says whether the file really exercises its rule.
 */
import { MS_PER_MINUTE } from '../../src/core/units';
import { type PolicyView } from './build';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioClaim,
  type ScenarioObservation,
} from './scenario-schema';
import { instantMs, truncateIso } from './time';

export type Proof = (scenario: Scenario, policy: PolicyView) => boolean;

export const ASCII_ONLY = /^[\x20-\x7E]+$/;

export const claimOf = (s: Scenario, e: ExpectedReceipt): ScenarioClaim | undefined =>
  s.input.claims.find((c) => c.ref === e.ref);

export const evidenceOf = (s: Scenario, e: ExpectedReceipt): ScenarioObservation | undefined =>
  s.input.observations.find((o) => o.ref === e.observationRefs[0]);

/** The observation `match.best` names: the evidence, else the asserted `match.best` param. */
export function bestOf(s: Scenario, e: ExpectedReceipt): ScenarioObservation | undefined {
  const named = e.reasonParams?.['match.best']?.observationId;
  const ref = e.observationRefs[0] ?? (typeof named === 'string' ? named : undefined);
  return s.input.observations.find((o) => o.ref === ref);
}

export const minutes = (count: number): number => count * MS_PER_MINUTE;

/** §4.1: the unit [start, end] of a minute-precision claim and its window [from, to], in epoch ms. */
export function minuteWindow(
  claim: ScenarioClaim,
  policy: PolicyView,
): { from: number; start: number; end: number; to: number } {
  const start = instantMs(truncateIso(claim.claimedAt, 'minute'));
  const end = start + MS_PER_MINUTE;
  return {
    from: start - minutes(policy.windows.beforeClaimMin),
    start,
    end,
    to: end + minutes(policy.windows.afterClaimMin),
  };
}
