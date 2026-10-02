/**
 * What a batch reads besides the claims' own candidates (docs/grading.md §3, §4.3, §7). Pure: every read goes
 * through the injected `ObservationIndex` and is bounded in time (§4.2).
 *
 *  - `visibleAt(index, evaluatedMs)`: the index as it was at `evaluatedAt`. Observations with
 *    `observedAt > evaluatedAt` are ignored (§3), so replay at an earlier instant sees exactly what grading saw.
 *  - `coveredObservations(index, coverage, policy)`: every observation of a covered type (one with sources)
 *    whose `occurredAt` lies in a window its own source's observer saw (`windowStart..windowEnd` of a coverage
 *    entry synced by `evaluatedAt`), counted once per `contentHash` (§4.1: the lowest id is kept, then the
 *    earliest sighting). These are the observations an orphan can be (§4.3: assigned to no claim, not taken).
 */
import type { ObservationIndex } from './candidates';
import { observedMs, occurredMs } from './candidates-time';
import { instantMs } from './normalize';
import type { Policy } from './policy';
import { ActionType, type Coverage, type Observation, type ObservationSource } from './schema';
import type { Interval } from './window';

/** The policy fields orphan discovery reads. A loaded `Policy` satisfies it. */
export type OrphanPolicy = Pick<Policy, 'sourcesByType'>;

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The rows first seen by `evaluatedMs`, in order. */
function seenBy(rows: readonly Observation[], evaluatedMs: number): Observation[] {
  const seen: Observation[] = [];
  for (const observation of rows) if (observedMs(observation) <= evaluatedMs) seen.push(observation);
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

/** Closed intervals merged where they overlap or touch, in ascending order. */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort(
    (a, b) => compareNumbers(a.startMs, b.startMs) || compareNumbers(a.endMs, b.endMs),
  );
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && next.startMs <= last.endMs) {
      merged[merged.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, next.endMs) };
    } else {
      merged.push(next);
    }
  }
  return merged;
}

/** Per source, the union of the windows its observers saw in passes synced by `evaluatedAt` (§3). */
export function seenWindows(coverage: Coverage): ReadonlyMap<ObservationSource, readonly Interval[]> {
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const bySource = new Map<ObservationSource, Interval[]>();
  for (const entry of coverage.observers) {
    if (instantMs(entry.lastSyncAt) > evaluatedMs) continue;
    const interval = { startMs: instantMs(entry.windowStart), endMs: instantMs(entry.windowEnd) };
    const held = bySource.get(entry.source);
    if (held === undefined) bySource.set(entry.source, [interval]);
    else held.push(interval);
  }
  return new Map([...bySource].map(([source, intervals]) => [source, mergeIntervals(intervals)]));
}

/** §4.1's representative of one `contentHash`: the lower id, then the earlier sighting, then the text. */
function preferred(held: Observation, next: Observation): Observation {
  const order =
    compareText(held.id, next.id) ||
    compareNumbers(observedMs(held), observedMs(next)) ||
    compareText(held.observedAt, next.observedAt);
  return order <= 0 ? held : next;
}

/** A covered observation and its `occurredAt` instant (epoch ms). */
export interface Keyed {
  readonly observation: Observation;
  readonly atMs: number;
}

/** (`occurredAt` instant, id, `contentHash`): the candidate order of §4.1, total after dedupe. */
function compareKeyed(a: Keyed, b: Keyed): number {
  return (
    compareNumbers(a.atMs, b.atMs) ||
    compareText(a.observation.id, b.observation.id) ||
    compareText(a.observation.contentHash, b.observation.contentHash)
  );
}

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

/** Adds the rows of `type` that lie in a window their OWN source was seen in (§3) to `found`, with their instant. */
function keepSeen(
  found: Keyed[],
  rows: readonly Observation[],
  type: ActionType,
  windows: ReadonlyMap<ObservationSource, readonly Interval[]>,
): void {
  for (const observation of rows) {
    if (observation.type !== type) continue;
    const own = windows.get(observation.source);
    if (own === undefined) continue;
    const atMs = occurredMs(observation);
    if (inWindows(own, atMs)) found.push({ observation, atMs });
  }
}

/** Observations of `type` in a window of their own source, read once over the union of every source's windows. */
async function readWindows(
  index: ObservationIndex,
  type: ActionType,
  windows: ReadonlyMap<ObservationSource, readonly Interval[]>,
  union: readonly Interval[],
): Promise<Keyed[]> {
  const found: Keyed[] = [];
  for (const window of union) {
    keepSeen(found, await index.byTypeAndBucket(type, window.startMs, window.endMs), type, windows);
  }
  return found;
}

/** Adds `rows` to `byHash`, one representative per `contentHash` (§4.1, `preferred`), with its own instant. */
function addOnce(byHash: Map<string, Keyed>, rows: readonly Keyed[]): void {
  for (const row of rows) {
    const { contentHash } = row.observation;
    const held = byHash.get(contentHash)?.observation;
    if (held === undefined || preferred(held, row.observation) !== held) byHash.set(contentHash, row);
  }
}

/**
 * Every observation of a type with sources whose `occurredAt` lies in a window its OWN source's observer saw (§3:
 * the observation's source, whether or not the policy lists it for the type), once per `contentHash`, in candidate
 * order (each instant read once, not once per comparison), with its `occurredAt` instant. `index` should already
 * be `visibleAt(evaluatedAt)`.
 */
export async function coveredObservations(
  index: ObservationIndex,
  coverage: Coverage,
  policy: OrphanPolicy,
): Promise<Keyed[]> {
  const windows = seenWindows(coverage);
  const union = mergeIntervals([...windows.values()].flat());
  const byHash = new Map<string, Keyed>();
  for (const type of ActionType.options) {
    if (policy.sourcesByType[type].length > 0)
      addOnce(byHash, await readWindows(index, type, windows, union));
  }
  return [...byHash.values()].sort(compareKeyed);
}
