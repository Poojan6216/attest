/**
 * What a batch reads besides the claims' own candidates (docs/grading.md §3, §4.3, §7). Pure: every read goes
 * through the injected `ObservationIndex` and is bounded in time (§4.2).
 *
 *  - `visibleAt(index, evaluatedMs)`: the index as it was at `evaluatedAt`. Observations with
 *    `observedAt > evaluatedAt` are ignored (§3), so replay at an earlier instant sees exactly what grading saw.
 *  - `isOrphanCandidate(observation, windows, policy)`: the one definition of an orphan candidate (§3): an
 *    observation from a source the policy lists for its type (§6.1 relevant sources, order.ts `fromRelevantSource`:
 *    the rule a claim's candidates obey, §4.1) whose `occurredAt` lies in a window its own source's observer saw
 *    (`windowStart..windowEnd` of a coverage entry synced by `evaluatedAt`, `seenWindows`). A row from a source the
 *    policy does not list for its type can neither verify a claim nor accuse an agent (Hard Rule 5). Batch grading
 *    (`coveredObservations`) and replay (replay.ts, for an UNASKED receipt's observation) both decide with it, so
 *    replay reproduces every UNASKED receipt the batch issues (Hard Rule 4).
 *  - `coveredObservations(index, coverage, policy)`: every orphan candidate, counted once per `contentHash` (§4.1:
 *    the lowest id is kept, then the earliest sighting; order.ts `representative`). These are the observations an
 *    orphan can be (§4.3: assigned to no claim, not taken).
 */
import type { ObservationIndex } from './candidates';
import { occurredMs } from './candidates-time';
import { instantMs } from './normalize';
import { compareCandidates, fromRelevantSource, mergeIntervals, type Placed, representative } from './order';
import type { Policy } from './policy';
import { ActionType, type Coverage, type Observation, type ObservationSource } from './schema';
import type { Interval } from './window';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const instantMsLocal = instantMs;
const representativeLocal = representative;
const compareCandidatesLocal = compareCandidates;
const fromRelevantSourceLocal = fromRelevantSource;

/** The policy fields orphan discovery reads. A loaded `Policy` satisfies it. */
export type OrphanPolicy = Pick<Policy, 'sourcesByType'>;

/** Per source, the closed, disjoint, ascending windows its observers saw (`seenWindows`). */
export type SeenWindows = ReadonlyMap<ObservationSource, readonly Interval[]>;

/**
 * The rows first seen by `evaluatedMs`, in order. Instants are read from the text here, not through the per-object
 * memo (candidates-time.ts): a batch reads each row a few times at most, and a memo entry per row would live as long
 * as the observation does, long after the batch (the task 1.5 perf gate: memory a major GC must mark).
 */
function seenBy(rows: readonly Observation[], evaluatedMs: number): Observation[] {
  const seen: Observation[] = [];
  for (const observation of rows)
    if (instantMsLocal(observation.observedAt) <= evaluatedMs) seen.push(observation);
  return seen;
}

/** `index` with every observation first seen after `evaluatedMs` left out of every read (§3). */
export function visibleAt(index: ObservationIndex, evaluatedMs: number): ObservationIndex {
  return {
    byTypeAndBucket: async (type, fromMs, toMs) =>
      seenBy(await index.byTypeAndBucket(type, fromMs, toMs), evaluatedMs),
    byCounterpartyToken: async (token, fromMs, toMs) =>
      seenBy(await index.byCounterpartyToken(token, fromMs, toMs), evaluatedMs),
  };
}

/** Per source, the union of the windows its observers saw in passes synced by `evaluatedAt` (§3). */
export function seenWindows(coverage: Coverage): SeenWindows {
  const evaluatedMs = instantMsLocal(coverage.evaluatedAt);
  const bySource = new Map<ObservationSource, Interval[]>();
  for (const entry of coverage.observers) {
    if (instantMsLocal(entry.lastSyncAt) > evaluatedMs) continue;
    const interval = { startMs: instantMsLocal(entry.windowStart), endMs: instantMsLocal(entry.windowEnd) };
    const held = bySource.get(entry.source);
    if (held === undefined) bySource.set(entry.source, [interval]);
    else held.push(interval);
  }
  return new Map([...bySource].map(([source, intervals]) => [source, mergeIntervals(intervals)]));
}

/** A covered observation and its `occurredAt` instant (epoch ms). */
export type Keyed = Placed;

/**
 * True iff `atMs` lies in one of `windows` (closed, disjoint and ascending, as `seenWindows` merges them): the
 * last window starting at or before `atMs` must reach it.
 */
function inWindows(windows: readonly Interval[], atMs: number): boolean {
  let low = 0;
  let high = windows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((windows[middle]?.startMs ?? atMs) <= atMs) low = middle + 1;
    else high = middle;
  }
  const window = windows[low - 1];
  return window !== undefined && atMs <= window.endMs;
}

/**
 * §3: whether `observation` can be an orphan of a batch whose observers saw `windows` (`seenWindows` of its
 * coverage): the policy lists its source for its type (`fromRelevantSource`, as for a claim's candidates; a type with
 * no sources lists none), and its `occurredAt` lies in a window its own source was seen in. The only definition:
 * gradeBatch (`coveredObservations`) and replay (replay.ts, for an UNASKED receipt's observation) both call it.
 */
export function isOrphanCandidate(
  observation: Observation,
  windows: SeenWindows,
  policy: OrphanPolicy,
): boolean {
  return orphanInstant(observation, windows, policy, occurredMs) !== null;
}

/**
 * `isOrphanCandidate`, returning the observation's `occurredAt` instant (read only once its own source has windows)
 * when it is an orphan candidate, else null.
 */
function orphanInstant(
  observation: Observation,
  windows: SeenWindows,
  policy: OrphanPolicy,
  occurredAtMs: (observation: Observation) => number,
): number | null {
  if (!fromRelevantSourceLocal(observation, observation.type, policy)) return null;
  const own = windows.get(observation.source);
  if (own === undefined) return null;
  const atMs = occurredAtMs(observation);
  return inWindows(own, atMs) ? atMs : null;
}

/** `occurredAt` read from its text (see `seenBy`). */
const occurredAtText = (observation: Observation): number => instantMsLocal(observation.occurredAt);

/** Adds the rows of `type` that are orphan candidates (`isOrphanCandidate`) to `found`, with their instant. */
function keepSeen(
  found: Keyed[],
  rows: readonly Observation[],
  type: ActionType,
  windows: SeenWindows,
  policy: OrphanPolicy,
): void {
  for (const observation of rows) {
    if (observation.type !== type) continue;
    const atMs = orphanInstant(observation, windows, policy, occurredAtText);
    if (atMs !== null) found.push({ observation, atMs });
  }
}

/** Observations of `type` in a window of their own source, read once over the union of its sources' windows. */
async function readWindows(
  index: ObservationIndex,
  type: ActionType,
  windows: SeenWindows,
  union: readonly Interval[],
  policy: OrphanPolicy,
): Promise<Keyed[]> {
  const found: Keyed[] = [];
  for (const window of union) {
    keepSeen(found, await index.byTypeAndBucket(type, window.startMs, window.endMs), type, windows, policy);
  }
  return found;
}

/** Adds `rows` to `byHash`, one representative per `contentHash` (§4.1, `representative`), with its own instant. */
function addOnce(byHash: Map<string, Keyed>, rows: readonly Keyed[]): void {
  for (const row of rows) {
    const { contentHash } = row.observation;
    const held = byHash.get(contentHash)?.observation;
    if (held === undefined || representativeLocal(held, row.observation) !== held)
      byHash.set(contentHash, row);
  }
}

/**
 * Every orphan candidate (`isOrphanCandidate`), once per `contentHash`, in candidate order (each instant read once,
 * not once per comparison), with its `occurredAt` instant. Each type with sources is read once over the union of the
 * windows of the sources the policy lists for it, then each row is held to its own source's windows. `index` should
 * already be `visibleAt(evaluatedAt)`.
 */
export async function coveredObservations(
  index: ObservationIndex,
  coverage: Coverage,
  policy: OrphanPolicy,
): Promise<Keyed[]> {
  const windows = seenWindows(coverage);
  const byHash = new Map<string, Keyed>();
  for (const type of ActionType.options) {
    const union = mergeIntervals(policy.sourcesByType[type].flatMap((source) => windows.get(source) ?? []));
    if (union.length > 0) addOnce(byHash, await readWindows(index, type, windows, union, policy));
  }
  return [...byHash.values()].sort(compareCandidatesLocal);
}
