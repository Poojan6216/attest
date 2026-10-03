/**
 * UNASKED attribution (docs/grading.md §7; module contract §13; Hard Rule 7).
 *
 * `attribute(orphan, activity, policy)` asks which agent LIKELY performed an observed action that no claim
 * explains. It reads allowlisted activity only (session pings, recorded idle periods, activity-log entries,
 * adapter syncs, claims) and the observation's subject hint, never content. Every window is measured from the
 * orphan's ANCHOR (order.ts `anchorAt`): for a `calendar.*` observation its first sighting (when the change was first
 * seen, `firstSeenAt`; the caller passes the representative, as gradeBatch does), for every other type its
 * `occurredAt`. Each agent is scored on its own:
 *
 *  - `agentSessionActive`: a session ping of the agent within ±`unasked.windows.sessionMin` of the anchor;
 *  - `userIdle` (agent-independent): ONE recorded idle interval covers `[anchor − idleMin, anchor]` (inclusive;
 *    intervals are never merged). Positive evidence only: no recorded interval means "not idle", never "idle";
 *  - `agentSignature`: the subject hint contains one of `unasked.signatures[agent]`, with ASCII-only case
 *    folding on both sides (§11: no NFKC, no `toLowerCase`);
 *  - `activityLogAdjacent`: an activity entry of the agent within ±`adjacentMin`, unless an ASSIGNABLE claim
 *    (§4.3, `features.isAssignable`) of that agent of the observation's type is within ±`adjacentMin` (assigned
 *    or not): the claim's time is its precision unit `[start(p,t), end(p,t)]` (§4.1). A vague claim never
 *    suppresses the signal, so it cannot hide an UNASKED. An entry's own `type` is informational and not read.
 *
 * An agent's score is the sum of its own fired signals' weights plus `userIdle`, capped at BASIS_POINTS, in
 * exact integer basis points (`policy.bp.unasked.signals`, §5.3). Only agents with at least one agent-specific
 * signal are candidates (`userIdle` alone attributes nothing); the likely agent has the highest score, then the
 * most fired signals (`userIdle` included), then the lowest agent id by UTF-16 code unit. The result is returned
 * whatever its score: `grade()` compares it with `unasked.threshold` (condition `unaskedLikely`).
 * `adapterLastSyncAt` is the attributed agent's latest adapter sync, which decides UNASKED finality.
 *
 * With `evaluatedAt` (§3), nothing from after it is read, so replay at that instant sees exactly what grading
 * saw: sessions, entries and adapter syncs after it are ignored, claims first observed after it are ignored, and
 * an idle interval counts only up to it (the part of an interval after `evaluatedAt` is no evidence yet).
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4). Nothing here ever states that an agent acted: the result
 * is a score, and every receipt built from it says "likely" (reason-text.ts).
 */
import {
  checkedSafe,
  indexBy,
  type IntervalIndex,
  intervalIndex,
  point,
  untilLimit,
} from './attribution-index';
import { type FeatureClaim, type FeaturePolicy, isAssignable } from './features';
import { asciiLower, instantMs } from './normalize';
import { anchorAt } from './order';
import { assertLoadedPolicy, type Policy } from './policy';
import {
  type ActionType,
  AgentId,
  type Attribution,
  type IsoTs,
  type Reason,
  type ReasonCode,
  UnaskedSignal,
} from './schema';
import { BASIS_POINTS, MS_PER_MINUTE } from './units';
import { type Interval, precisionBounds } from './window';

export { AttributionError, type AttributionErrorCode } from './attribution-index';

/**
 * The observation fields attribution reads. A parsed `Observation` satisfies it. Its first sighting (`sightedAt`,
 * else `observedAt`) anchors a `calendar.*` observation (§7); pass the representative of its `contentHash`.
 */
export interface AttributionOrphan {
  readonly type: ActionType;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly sightedAt?: string | undefined;
  readonly subjectHint?: string | undefined;
}

/**
 * The claim fields attribution reads (adjacency suppression): what `isAssignable` reads, the agent, and when the
 * claim was first read (`observedAt`, filtered by `evaluatedAt`). A parsed `Claim` satisfies it.
 */
export interface AttributionClaim extends FeatureClaim {
  readonly agent: AgentId;
  readonly observedAt: string;
}

interface AgentAt {
  readonly agent: AgentId;
  readonly at: string;
}

/**
 * An activity-log entry. Its optional `type` is informational and not read: §7 fires `activityLogAdjacent` on
 * any entry of the agent and asks only whether an assignable CLAIM of the observation's type is near.
 */
interface ActivityEntry extends AgentAt {
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

/**
 * Attributes one orphan observation; built once per activity by `attributor`. `occurredMs`, when the caller
 * already has it, is `instantMs(orphan.occurredAt)` (a batch has every orphan's instant from its index); a
 * `calendar.*` orphan is anchored on its first sighting instead (§7), whatever `occurredMs` says. `wanted`, when
 * given, is asked about the likely agent and its score first, and false gives null without building the attribution
 * (a batch builds one only for an orphan that becomes an UNASKED receipt).
 */
export type Attributor = (
  orphan: AttributionOrphan,
  occurredMs?: number,
  wanted?: (agent: AgentId, scoreBp: number) => boolean,
) => Attribution | null;

/** Each fired signal's reason code (§15), in the table order reasons are emitted in (`attributionReasons`). */
const SIGNAL_REASON: Readonly<Record<UnaskedSignal, ReasonCode>> = Object.freeze({
  agentSessionActive: 'unasked.session',
  userIdle: 'unasked.idle',
  agentSignature: 'unasked.signature',
  activityLogAdjacent: 'unasked.adjacent',
});

/** One agent's activity, indexed once: each question an orphan asks is one binary search. */
interface AgentIndex {
  readonly agent: AgentId;
  readonly sessions: IntervalIndex | undefined;
  readonly entries: IntervalIndex | undefined;
  /** The agent's suppressing claims (`suppressingClaims`) by type, each as its precision unit (§4.1). */
  readonly claims: ReadonlyMap<ActionType, IntervalIndex>;
  /** The agent's signatures, ASCII-lowercased. */
  readonly signatures: readonly string[];
  readonly lastSync: IsoTs | undefined;
}

interface ActivityIndex {
  /** Only agents that can fire an agent-specific signal at all (a session, an entry or a signature). */
  readonly agents: readonly AgentIndex[];
  readonly idle: IntervalIndex;
  readonly anySignature: boolean;
}

/** The signal windows in ms, each a safe integer (the policy loader caps them; checked again here). */
interface WindowsMs {
  readonly session: number;
  readonly idle: number;
  readonly adjacent: number;
}

/**
 * The best candidate for one orphan so far (its agent is `weigh`'s result): its capped score, number of fired
 * signals and which of its own
 * signals fired (`userIdle` is the orphan's, the same for every agent). Reused for every orphan of one attributor
 * (reset per orphan; everything here is synchronous), so attributing an orphan allocates only its result.
 */
interface Best {
  scoreBp: number;
  count: number;
  session: boolean;
  signature: boolean;
  adjacent: boolean;
}

/** §3: the instant after which nothing is read: `evaluatedAt`'s, or +∞ without one. */
function limitOf(evaluatedAt: string | undefined): number {
  return evaluatedAt === undefined ? Number.POSITIVE_INFINITY : instantMs(evaluatedAt);
}

/**
 * Each agent's latest adapter sync at or before `limitMs`, by instant; equal instants written differently resolve
 * to the smallest string, so the result does not depend on input order.
 */
function latestSyncs(syncs: AttributionActivity['adapterSyncs'], limitMs: number): Map<AgentId, IsoTs> {
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
function suppressingClaims(
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

function indexActivity(
  activity: AttributionActivity,
  policy: AttributionPolicy,
  evaluatedAt?: string,
): ActivityIndex {
  const limitMs = limitOf(evaluatedAt);
  const at = (item: AgentAt) => point(instantMs(item.at));
  const agentOf = (item: AgentAt) => item.agent;
  const sessions = indexBy(activity.sessions, agentOf, at, limitMs);
  const entries = indexBy(activity.entries, agentOf, at, limitMs);
  const lastSync = latestSyncs(activity.adapterSyncs, limitMs);
  const claimsOf = suppressingClaims(activity.claims, entries, policy, limitMs);
  const agents = AgentId.options.map((agent): AgentIndex => ({
    agent,
    sessions: sessions.get(agent),
    entries: entries.get(agent),
    claims: indexBy(claimsOf.get(agent) ?? [], (claim) => claim.type, precisionBounds),
    signatures: policy.unasked.signatures[agent].map(asciiLower),
    lastSync: lastSync.get(agent),
  }));
  const active = agents.filter(
    (agent) => agent.sessions !== undefined || agent.entries !== undefined || agent.signatures.length > 0,
  );
  const idle: Interval[] = [];
  for (const { from, to } of activity.idle) {
    const interval = untilLimit({ startMs: instantMs(from), endMs: instantMs(to) }, limitMs);
    if (interval !== null) idle.push(interval);
  }
  return {
    agents: active,
    idle: intervalIndex(idle),
    anySignature: active.some((agent) => agent.signatures.length > 0),
  };
}

function windowsMs(policy: AttributionPolicy): WindowsMs {
  const { sessionMin, idleMin, adjacentMin } = policy.unasked.windows;
  return {
    session: checkedSafe(sessionMin * MS_PER_MINUTE),
    idle: checkedSafe(idleMin * MS_PER_MINUTE),
    adjacent: checkedSafe(adjacentMin * MS_PER_MINUTE),
  };
}

/** Whether `index` holds an interval within ±`radius` ms of `ms` (distance 0 when `ms` lies inside it). */
function near(index: IntervalIndex | undefined, ms: number, radius: number): boolean {
  return index?.exists(checkedSafe(ms + radius), checkedSafe(ms - radius)) ?? false;
}

/** Signals in the schema's order (also the §15 reason order): session, idle, signature, adjacent. */
function inSignalOrder(signals: readonly UnaskedSignal[]): UnaskedSignal[] {
  return UnaskedSignal.options.filter((signal) => signals.includes(signal));
}

/** Whether the ASCII-lowercased subject contains one of the agent's signatures (`agentSignature`). */
function signed(signatures: readonly string[], subject: string): boolean {
  for (const text of signatures) if (subject.includes(text)) return true;
  return false;
}

/** What weighing reads besides the agent: the orphan's facts and the attributor's own. */
interface Weighing {
  readonly windows: WindowsMs;
  readonly policy: AttributionPolicy;
  readonly best: Best;
  type: ActionType;
  /** The orphan's anchor instant (§7, order.ts `anchorAt`): first sighting for `calendar.*`, else `occurredAt`. */
  anchorMs: number;
  /** The subject hint, ASCII-lowercased ('' without one, or when no agent has a signature). */
  subject: string;
  idle: boolean;
}

/**
 * Weighs `agent` for the orphan (§7) and keeps it in `best` when it beats `held`, the best so far (returns the
 * best after it): a higher score (the sum of its fired signals' weights, `userIdle` included, capped at
 * BASIS_POINTS), then more fired signals (`userIdle` included), then the lower agent id by UTF-16 code unit. An
 * agent with no agent-specific signal is no candidate.
 */
function weigh(agent: AgentIndex, w: Weighing, held: AgentIndex | null): AgentIndex | null {
  const { windows, best, anchorMs, idle } = w;
  const session = near(agent.sessions, anchorMs, windows.session);
  const signature = signed(agent.signatures, w.subject);
  const adjacent =
    near(agent.entries, anchorMs, windows.adjacent) &&
    !near(agent.claims.get(w.type), anchorMs, windows.adjacent);
  if (!session && !signature && !adjacent) return held;
  const weights = w.policy.bp.unasked.signals;
  const total =
    (session ? weights.agentSessionActive : 0) +
    (idle ? weights.userIdle : 0) +
    (signature ? weights.agentSignature : 0) +
    (adjacent ? weights.activityLogAdjacent : 0);
  const scoreBp = Math.min(total, BASIS_POINTS);
  const count = Number(session) + Number(idle) + Number(signature) + Number(adjacent);
  if (held !== null) {
    const loses =
      scoreBp !== best.scoreBp
        ? scoreBp < best.scoreBp
        : count !== best.count
          ? count < best.count
          : agent.agent >= held.agent;
    if (loses) return held;
  }
  best.scoreBp = scoreBp;
  best.count = count;
  best.session = session;
  best.signature = signature;
  best.adjacent = adjacent;
  return agent;
}

/** The attribution of the best candidate (§7): its fired signals in UnaskedSignal order, `adapterLastSyncAt`. */
function attributionOf(best: Best, agent: AgentIndex, idle: boolean): Attribution {
  const fired = [best.session, idle, best.signature, best.adjacent];
  const signals = UnaskedSignal.options.filter((_, i) => fired[i] === true);
  const attribution: Attribution = { agent: agent.agent, scoreBp: best.scoreBp, signals };
  return agent.lastSync === undefined ? attribution : { ...attribution, adapterLastSyncAt: agent.lastSync };
}

/** §7: the instant every window of `orphan` is measured from. `occurredMs`, when given, is its occurredAt's. */
function anchorOf(orphan: AttributionOrphan, occurredMs: number | undefined): number {
  const anchor = anchorAt(orphan);
  return anchor === orphan.occurredAt && occurredMs !== undefined ? occurredMs : instantMs(anchor);
}

/**
 * Indexes `activity` once and returns a function that attributes any orphan against it, so a batch pays for
 * sorting and planning claims once instead of per orphan. Same results as `attribute` for every orphan. Throws
 * `PolicyError('policy_not_loaded')` for a policy `loadPolicy` did not return (Hard Rule 6).
 */
export function attributor(
  activity: AttributionActivity,
  policy: AttributionPolicy,
  evaluatedAt?: string,
): Attributor {
  assertLoadedPolicy(policy);
  const index = indexActivity(activity, policy, evaluatedAt);
  const windows = windowsMs(policy);
  const best: Best = { scoreBp: 0, count: 0, session: false, signature: false, adjacent: false };
  const w: Weighing = { windows, policy, best, type: 'other', anchorMs: 0, subject: '', idle: false };
  return (orphan, occurredMs, wanted) => {
    const anchorMs = anchorOf(orphan, occurredMs);
    w.subject = index.anySignature && orphan.subjectHint !== undefined ? asciiLower(orphan.subjectHint) : '';
    w.idle = index.idle.exists(checkedSafe(anchorMs - windows.idle), anchorMs);
    w.type = orphan.type;
    w.anchorMs = anchorMs;
    let winner: AgentIndex | null = null;
    for (const agent of index.agents) winner = weigh(agent, w, winner);
    if (winner === null || wanted?.(winner.agent, best.scoreBp) === false) return null;
    return attributionOf(best, winner, w.idle);
  };
}

/**
 * §7: the likely agent for `orphan`, or null when no agent-specific signal fired. With `evaluatedAt`, nothing
 * from after it is read (§3). Throws `NormalizeError` for a timestamp that is not ISO with an offset,
 * `AttributionError('unsafe_window')` for a window bound outside the safe-integer range, and `WindowError` for
 * a claim whose precision unit cannot be read. To attribute many orphans against one activity, use `attributor`.
 */
export function attribute(
  orphan: AttributionOrphan,
  activity: AttributionActivity,
  policy: AttributionPolicy,
  evaluatedAt?: string,
): Attribution | null {
  return attributor(activity, policy, evaluatedAt)(orphan);
}

/**
 * The reasons an UNASKED receipt lists for `attribution` (§7, §15): one `unasked.*` code per fired signal,
 * `userIdle` included, each naming the attributed agent, in table order. grade-reasons.ts writes an UNASKED
 * receipt's rule reasons with this function: it is the only map from signal to reason code.
 */
export function attributionReasons(attribution: Pick<Attribution, 'agent' | 'signals'>): Reason[] {
  return inSignalOrder(attribution.signals).map((signal) => ({
    code: SIGNAL_REASON[signal],
    params: { agent: attribution.agent },
  }));
}
