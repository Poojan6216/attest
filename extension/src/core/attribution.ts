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
 *  - `agentSessionActive`: a session ping of the agent within ±`unasked.windows.sessionMin` of the anchor. A ping at
 *    the instant of one of the agent's entries is that entry (one fact, v1.17): when `activityLogAdjacent` fires and
 *    every ping in reach sits at the instant of an entry that fires it, only the heavier of the two signals fires
 *    (`activityLogAdjacent` on a tie), so one pasted entry never sums two weights (./attribution-activity.ts);
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
import {
  type AgentAt,
  type AttributionActivity,
  type AttributionPolicy,
  instantsBy,
  latestSyncs,
  ownPing,
  suppressingClaims,
  type WindowsMs,
  windowsMs,
} from './attribution-activity';
import { asciiLower, instantMs } from './normalize';
import { anchorAt } from './order';
import { assertLoadedPolicy } from './policy';
import {
  type ActionType,
  AgentId,
  type Attribution,
  type IsoTs,
  type Reason,
  type ReasonCode,
  UnaskedSignal,
} from './schema';
import { BASIS_POINTS } from './units';
import { type Interval, precisionBounds } from './window';

export { AttributionError, type AttributionErrorCode } from './attribution-index';
export type { AttributionActivity, AttributionClaim, AttributionPolicy } from './attribution-activity';

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
  /** The instants of its session pings, ascending, and of its entries: the one-fact rule's (v1.17). */
  readonly sessionMs: readonly number[];
  readonly entryMs: ReadonlySet<number>;
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
  const sessionMs = instantsBy(activity.sessions, limitMs);
  const entryMs = instantsBy(activity.entries, limitMs);
  const lastSync = latestSyncs(activity.adapterSyncs, limitMs);
  const claimsOf = suppressingClaims(activity.claims, entries, policy, limitMs);
  const agents = AgentId.options.map((agent): AgentIndex => ({
    agent,
    sessions: sessions.get(agent),
    entries: entries.get(agent),
    sessionMs: sessionMs.get(agent) ?? [],
    entryMs: new Set(entryMs.get(agent)),
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
  const weights = w.policy.bp.unasked.signals;
  let session = near(agent.sessions, anchorMs, windows.session);
  const signature = signed(agent.signatures, w.subject);
  let adjacent =
    near(agent.entries, anchorMs, windows.adjacent) &&
    !near(agent.claims.get(w.type), anchorMs, windows.adjacent);
  // One fact (v1.17): pings only at the instants of the entries that fire adjacency are those entries.
  if (session && adjacent && !ownPing(agent.sessionMs, agent.entryMs, anchorMs, windows)) {
    if (weights.agentSessionActive > weights.activityLogAdjacent) adjacent = false;
    else session = false;
  }
  if (!session && !signature && !adjacent) return held;
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
