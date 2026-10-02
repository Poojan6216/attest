/**
 * The grant of each agent in force at `coverage.evaluatedAt` (docs/grading.md §3: "the Grant for the claim's
 * agent in force at coverage.evaluatedAt"). Pure.
 *
 * A grant is in force from its `updatedAt` instant on: the one with the latest `updatedAt` not after
 * `evaluatedAt`. A grant written after `evaluatedAt` is ignored, like coverage and observations from after it
 * (§3), so replay at an earlier instant sees the grant grading saw. Two grants of one agent with the same
 * `updatedAt` instant make the batch undecidable and throw.
 */
import { BatchError } from './batch-error';
import { instantMs } from './normalize';
import type { AgentId, Grant } from './schema';

interface Dated {
  readonly grant: Grant;
  readonly updatedMs: number;
}

/** The grant in force per agent (agents with none in force are absent). */
export function grantsInForce(grants: readonly Grant[], evaluatedMs: number): ReadonlyMap<AgentId, Grant> {
  const latest = new Map<AgentId, Dated>();
  const tied = new Set<AgentId>();
  for (const grant of grants) {
    const updatedMs = instantMs(grant.updatedAt);
    if (updatedMs > evaluatedMs) continue;
    const held = latest.get(grant.agent);
    if (held !== undefined && held.updatedMs > updatedMs) continue;
    if (held?.updatedMs === updatedMs) tied.add(grant.agent);
    else tied.delete(grant.agent);
    latest.set(grant.agent, { grant, updatedMs });
  }
  if (tied.size > 0) throw new BatchError('ambiguous_grant');
  return new Map([...latest].map(([agent, dated]) => [agent, dated.grant]));
}

/** The grant of `agent` in force, or `BatchError('missing_grant')`. */
export function grantOf(grants: ReadonlyMap<AgentId, Grant>, agent: AgentId): Grant {
  const grant = grants.get(agent);
  if (grant === undefined) throw new BatchError('missing_grant');
  return grant;
}
