/**
 * The activity UNASKED attribution reads (docs/grading.md §7), indexed apart from ./attribution.ts: the shapes it
 * reads, its windows in ms, each agent's latest adapter sync, the claims that can suppress an agent's
 * `activityLogAdjacent`, and the instants of its session pings and entries for the one-fact rule (v1.17): a session
 * ping and an activity entry of one agent at one instant are one fact (a pasted log's timed entry is both), so they
 * never sum two weights.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { checkedSafe, countAtMost, type IntervalIndex } from './attribution-index';
import { type FeatureClaim, type FeaturePolicy, isAssignable } from './features';
import { instantMs } from './normalize';
import type { Policy } from './policy';
import type { ActionType, AgentId, IsoTs } from './schema';
import { MS_PER_MINUTE } from './units';
import { precisionBounds } from './window';

/**
 * The claim fields attribution reads (adjacency suppression): what `isAssignable` reads, the agent, and when the
 * claim was first read (`observedAt`, filtered by `evaluatedAt`). A parsed `Claim` satisfies it.
 */
export interface AttributionClaim extends FeatureClaim {
  readonly agent: AgentId;
  readonly observedAt: string;
}

export interface AgentAt {
  readonly agent: AgentId;
  readonly at: string;
}

/**
 * An activity-log entry. Its optional `type` is informational and not read: §7 fires `activityLogAdjacent` on
 * any entry of the agent and asks only whether an assignable CLAIM of the observation's type is near.
 */
export interface ActivityEntry extends AgentAt {
  readonly type?: ActionType | undefined;
}

/** The activity attribution reads (§7 `Activity`). A parsed `Activity` satisfies it. */
export interface AttributionActivity {
  readonly sessions: readonly AgentAt[];
  readonly idle: readonly { readonly from: string; readonly to: string }[];
  readonly entries: readonly ActivityEntry[];
  readonly adapterSyncs: readonly { readonly agent: AgentId; readonly lastSyncAt: IsoTs }[];
  readonly claims: readonly AttributionClaim[];
}

/** The policy fields attribution reads (`isAssignable` reads the feature fields). A loaded `Policy` satisfies it. */
export type AttributionPolicy = FeaturePolicy & Pick<Policy, 'unasked'>;

/** The signal windows in ms, each a safe integer (the policy loader caps them; checked again here). */
export interface WindowsMs {
  readonly session: number;
  readonly idle: number;
  readonly adjacent: number;
}

/** The policy's signal windows in ms (`WindowsMs`). */
export function windowsMs(policy: AttributionPolicy): WindowsMs {
  const { sessionMin, idleMin, adjacentMin } = policy.unasked.windows;
  return {
    session: checkedSafe(sessionMin * MS_PER_MINUTE),
    idle: checkedSafe(idleMin * MS_PER_MINUTE),
    adjacent: checkedSafe(adjacentMin * MS_PER_MINUTE),
  };
}

/**
 * Each agent's latest adapter sync at or before `limitMs`, by instant; equal instants written differently resolve
 * to the smallest string, so the result does not depend on input order.
 */
export function latestSyncs(
  syncs: AttributionActivity['adapterSyncs'],
  limitMs: number,
): Map<AgentId, IsoTs> {
  const latest = new Map<AgentId, { readonly ms: number; readonly at: IsoTs }>();
  for (const sync of syncs) {
    const ms = instantMs(sync.lastSyncAt);
    if (ms > limitMs) continue;
    const held = latest.get(sync.agent);
    if (held === undefined || ms > held.ms || (ms === held.ms && sync.lastSyncAt < held.at)) {
      latest.set(sync.agent, { ms, at: sync.lastSyncAt });
    }
  }
  return new Map([...latest].map(([agent, { at }]) => [agent, at]));
}

/**
 * Per agent, the claims that can suppress its `activityLogAdjacent` (§7): ASSIGNABLE (§4.3) and first read at or
 * before `limitMs`. Only a claim whose precision unit lies within 2 × `adjacentMin` of one of the agent's
 * entries can ever matter (the entry and the claim are each within `adjacentMin` of the anchor), so no other
 * claim is planned: the result is the same, and a batch plans a handful of claims instead of every one.
 */
export function suppressingClaims(
  claims: readonly AttributionClaim[],
  entries: ReadonlyMap<AgentId, IntervalIndex>,
  policy: AttributionPolicy,
  limitMs: number,
): Map<AgentId, AttributionClaim[]> {
  const { adjacent } = windowsMs(policy);
  const reach = checkedSafe(adjacent + adjacent);
  const claimsOf = new Map<AgentId, AttributionClaim[]>();
  for (const claim of claims) {
    const agentEntries = entries.get(claim.agent);
    if (agentEntries === undefined || instantMs(claim.observedAt) > limitMs) continue;
    const unit = precisionBounds(claim);
    if (!agentEntries.exists(checkedSafe(unit.endMs + reach), checkedSafe(unit.startMs - reach))) continue;
    if (!isAssignable(claim, policy)) continue;
    const held = claimsOf.get(claim.agent);
    if (held === undefined) claimsOf.set(claim.agent, [claim]);
    else held.push(claim);
  }
  return claimsOf;
}

/** Each agent's instants of `items` at or before `limitMs`, ascending (its session pings, or its entries). */
export function instantsBy(items: readonly AgentAt[], limitMs: number): Map<AgentId, number[]> {
  const byAgent = new Map<AgentId, number[]>();
  for (const item of items) {
    const ms = instantMs(item.at);
    if (ms > limitMs) continue;
    const held = byAgent.get(item.agent);
    if (held === undefined) byAgent.set(item.agent, [ms]);
    else held.push(ms);
  }
  for (const list of byAgent.values()) list.sort((a, b) => a - b);
  return byAgent;
}

/**
 * The one-fact rule (§7 v1.17): whether one of the agent's session pings within ±`windows.session` of `anchorMs` is a
 * fact of its own, not the instant of one of its entries within ±`windows.adjacent` (an entry that fires
 * `activityLogAdjacent`). `sessions` holds the agent's ping instants, ascending; `entries` its entry instants.
 */
export function ownPing(
  sessions: readonly number[],
  entries: ReadonlySet<number>,
  anchorMs: number,
  windows: WindowsMs,
): boolean {
  const end = countAtMost(sessions, checkedSafe(anchorMs + windows.session));
  for (let i = countAtMost(sessions, checkedSafe(anchorMs - windows.session) - 1); i < end; i += 1) {
    const ms = sessions[i];
    if (ms !== undefined && (!entries.has(ms) || Math.abs(ms - anchorMs) > windows.adjacent)) return true;
  }
  return false;
}
