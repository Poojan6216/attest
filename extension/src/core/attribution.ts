/**
 * UNASKED attribution (docs/grading.md §7; module contract §13; Hard Rule 7).
 *
 * `attribute(orphan, activity, policy)` asks which agent LIKELY performed an observed action that no claim
 * explains. It reads allowlisted activity only (session pings, recorded idle periods, activity-log entries,
 * adapter syncs, claims) and the observation's subject hint, never content. Each agent is scored on its own:
 *
 *  - `agentSessionActive`: a session ping of the agent within ±`unasked.windows.sessionMin` of `occurredAt`;
 *  - `userIdle` (agent-independent): ONE recorded idle interval covers `[occurredAt − idleMin, occurredAt]`.
 *    Positive evidence only: no recorded interval means "not idle", never "idle";
 *  - `agentSignature`: the subject hint contains one of `unasked.signatures[agent]`, ASCII case-insensitively;
 *  - `activityLogAdjacent`: an activity entry of the agent within ±`adjacentMin`, unless a claim of that
 *    agent of the observation's type is within ±`adjacentMin` (assigned or not): the claim's time is its
 *    precision unit `[start(p,t), end(p,t)]` (§4.1).
 *
 * An agent's score is the sum of its own fired signals' weights plus `userIdle`, capped at BASIS_POINTS, in
 * exact integer basis points (`policy.bp.unasked.signals`, §5.3). Only agents with at least one agent-specific
 * signal are candidates (`userIdle` alone attributes nothing); the likely agent has the highest score, then the
 * most fired signals, then the lowest agent id. The result is returned whatever its score: `grade()` compares
 * it with `unasked.threshold` (condition `unaskedLikely`). `adapterLastSyncAt` is the attributed agent's latest
 * adapter sync (at or before `evaluatedAt` when one is given), which decides UNASKED finality.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4). Nothing here ever states that an agent acted: the result
 * is a score, and every receipt built from it says "likely" (reason-text.ts).
 */
import { checkedSafe, indexBy, type IntervalIndex, intervalIndex, point } from './attribution-index';
import { asciiLower, instantMs } from './normalize';
import type { Policy } from './policy';
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
import { precisionBounds, type WindowClaim } from './window';

export { AttributionError, type AttributionErrorCode } from './attribution-index';

/** The observation fields attribution reads. A parsed `Observation` satisfies it. */
export interface AttributionOrphan {
  readonly type: ActionType;
  readonly occurredAt: string;
  readonly subjectHint?: string | undefined;
}

/** The claim fields attribution reads (adjacency suppression). A parsed `Claim` satisfies it. */
export interface AttributionClaim extends Pick<
  WindowClaim,
  'claimedAt' | 'claimedAtPrecision' | 'claimedAtEnd'
> {
  readonly agent: AgentId;
  readonly type: ActionType;
}

interface AgentAt {
  readonly agent: AgentId;
  readonly at: string;
}

/**
 * An activity-log entry. Its optional `type` is accepted and not read: §7 fires `activityLogAdjacent` on any
 * entry of the agent and asks only whether a CLAIM of the observation's type is near.
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

/** The policy fields attribution reads. A loaded `Policy` satisfies it. */
export type AttributionPolicy = Pick<Policy, 'bp' | 'unasked'>;

/** Attributes one orphan observation; built once per activity by `attributor`. */
export type Attributor = (orphan: AttributionOrphan) => Attribution | null;

/** Each fired signal's reason code (§15), in the table order reasons are emitted in. */
export const SIGNAL_REASON: Readonly<Record<UnaskedSignal, ReasonCode>> = Object.freeze({
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
  /** The agent's claims by type, each as its precision unit (§4.1). */
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

/** What attribution reads from the orphan, computed once per orphan. */
interface OrphanFacts {
  readonly type: ActionType;
  readonly occurredMs: number;
  /** The subject hint, ASCII-lowercased ('' without one, or when no agent has a signature). */
  readonly subject: string;
  readonly idle: boolean;
}

interface Candidate {
  readonly agent: AgentId;
  readonly scoreBp: number;
  readonly signals: readonly UnaskedSignal[];
}

/**
 * Each agent's latest adapter sync, by instant; equal instants written differently resolve to the smallest
 * string, so the result does not depend on input order. Syncs after `evaluatedAt` (when given) are ignored.
 */
function latestSyncs(syncs: AttributionActivity['adapterSyncs'], evaluatedAt?: string): Map<AgentId, IsoTs> {
  const limitMs = evaluatedAt === undefined ? Number.POSITIVE_INFINITY : instantMs(evaluatedAt);
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

function indexActivity(
  activity: AttributionActivity,
  policy: AttributionPolicy,
  evaluatedAt?: string,
): ActivityIndex {
  const at = (item: AgentAt) => point(instantMs(item.at));
  const sessions = indexBy(activity.sessions, (item) => item.agent, at);
  const entries = indexBy(activity.entries, (item) => item.agent, at);
  const lastSync = latestSyncs(activity.adapterSyncs, evaluatedAt);
  const agents = AgentId.options.map((agent): AgentIndex => ({
    agent,
    sessions: sessions.get(agent),
    entries: entries.get(agent),
    claims: indexBy(
      activity.claims.filter((claim) => claim.agent === agent),
      (claim) => claim.type,
      precisionBounds,
    ),
    signatures: policy.unasked.signatures[agent].map(asciiLower),
    lastSync: lastSync.get(agent),
  }));
  const active = agents.filter(
    (agent) => agent.sessions !== undefined || agent.entries !== undefined || agent.signatures.length > 0,
  );
  return {
    agents: active,
    idle: intervalIndex(
      activity.idle.map((idle) => ({ startMs: instantMs(idle.from), endMs: instantMs(idle.to) })),
    ),
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

function score(signals: readonly UnaskedSignal[], policy: AttributionPolicy): number {
  const total = signals.reduce((sum, signal) => sum + policy.bp.unasked.signals[signal], 0);
  return Math.min(total, BASIS_POINTS);
}

/**
 * The agent's candidacy: its fired signals in UnaskedSignal order (session, idle, signature, adjacent; also the
 * §15 reason order) and their capped score, or null when no agent-specific signal fired.
 */
function candidateOf(
  agent: AgentIndex,
  orphan: OrphanFacts,
  windows: WindowsMs,
  policy: AttributionPolicy,
): Candidate | null {
  const { occurredMs } = orphan;
  const session = near(agent.sessions, occurredMs, windows.session);
  const signature = agent.signatures.some((text) => orphan.subject.includes(text));
  const adjacent =
    near(agent.entries, occurredMs, windows.adjacent) &&
    !near(agent.claims.get(orphan.type), occurredMs, windows.adjacent);
  if (!session && !signature && !adjacent) return null;
  const signals: UnaskedSignal[] = [];
  if (session) signals.push('agentSessionActive');
  if (orphan.idle) signals.push('userIdle');
  if (signature) signals.push('agentSignature');
  if (adjacent) signals.push('activityLogAdjacent');
  return { agent: agent.agent, scoreBp: score(signals, policy), signals };
}

/** Signals in the schema's order (also the §15 reason order): session, idle, signature, adjacent. */
function inSignalOrder(signals: readonly UnaskedSignal[]): UnaskedSignal[] {
  return UnaskedSignal.options.filter((signal) => signals.includes(signal));
}

/** Higher score, then more fired signals, then the lower agent id (§7). */
function better(a: Candidate, b: Candidate): boolean {
  if (a.scoreBp !== b.scoreBp) return a.scoreBp > b.scoreBp;
  if (a.signals.length !== b.signals.length) return a.signals.length > b.signals.length;
  return a.agent < b.agent;
}

function orphanFacts(orphan: AttributionOrphan, index: ActivityIndex, windows: WindowsMs): OrphanFacts {
  const occurredMs = instantMs(orphan.occurredAt);
  return {
    type: orphan.type,
    occurredMs,
    subject: index.anySignature && orphan.subjectHint !== undefined ? asciiLower(orphan.subjectHint) : '',
    idle: index.idle.exists(checkedSafe(occurredMs - windows.idle), occurredMs),
  };
}

/**
 * Indexes `activity` once and returns a function that attributes any orphan against it, so a batch pays for
 * sorting once instead of per orphan. Same results as `attribute` for every orphan.
 */
export function attributor(
  activity: AttributionActivity,
  policy: AttributionPolicy,
  evaluatedAt?: string,
): Attributor {
  const index = indexActivity(activity, policy, evaluatedAt);
  const windows = windowsMs(policy);
  return (orphan) => {
    const facts = orphanFacts(orphan, index, windows);
    let best: Candidate | null = null;
    let bestIndex: AgentIndex | null = null;
    for (const agent of index.agents) {
      const candidate = candidateOf(agent, facts, windows, policy);
      if (candidate !== null && (best === null || better(candidate, best))) {
        best = candidate;
        bestIndex = agent;
      }
    }
    if (best === null || bestIndex === null) return null;
    const attribution: Attribution = { agent: best.agent, scoreBp: best.scoreBp, signals: [...best.signals] };
    return bestIndex.lastSync === undefined
      ? attribution
      : { ...attribution, adapterLastSyncAt: bestIndex.lastSync };
  };
}

/**
 * §7: the likely agent for `orphan`, or null when no agent-specific signal fired. Throws `NormalizeError` for
 * a timestamp that is not ISO with an offset, and `AttributionError('unsafe_window')` for a window bound
 * outside the safe-integer range. To attribute many orphans against one activity, use `attributor`.
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
 * `userIdle` included, each naming the attributed agent, in table order.
 */
export function attributionReasons(attribution: Pick<Attribution, 'agent' | 'signals'>): Reason[] {
  return inSignalOrder(attribution.signals).map((signal) => ({
    code: SIGNAL_REASON[signal],
    params: { agent: attribution.agent },
  }));
}
