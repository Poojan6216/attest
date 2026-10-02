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

/** `index` with every observation first seen after `evaluatedMs` left out of every read (§3). */
export function visibleAt(index: ObservationIndex, evaluatedMs: number): ObservationIndex {
  const visible = (rows: readonly Observation[]): Observation[] =>
    rows.filter((observation) => observedMs(observation) <= evaluatedMs);
  return {
    byTypeAndBucket: async (type, fromMs, toMs) => visible(await index.byTypeAndBucket(type, fromMs, toMs)),
    byCounterpartyToken: async (token, fromMs, toMs) =>
      visible(await index.byCounterpartyToken(token, fromMs, toMs)),
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

/** (`occurredAt` instant, id, `contentHash`): the candidate order of §4.1, total after dedupe. */
function compareObservations(a: Observation, b: Observation): number {
  return (
    compareNumbers(occurredMs(a), occurredMs(b)) ||
    compareText(a.id, b.id) ||
    compareText(a.contentHash, b.contentHash)
  );
}

/** Observations of `type` from `source` that lie in one of `windows`, read window by window. */
async function readWindows(
  index: ObservationIndex,
  type: ActionType,
  source: ObservationSource,
  windows: readonly Interval[],
): Promise<Observation[]> {
  const found: Observation[] = [];
  for (const { startMs, endMs } of windows) {
    for (const observation of await index.byTypeAndBucket(type, startMs, endMs)) {
      if (observation.type !== type || observation.source !== source) continue;
      const ms = occurredMs(observation);
      if (ms >= startMs && ms <= endMs) found.push(observation);
    }
  }
  return found;
}

/**
 * Every observation of a covered type that its own source's observer saw, once per `contentHash`, in
 * candidate order. `index` should already be `visibleAt(evaluatedAt)`.
 */
export async function coveredObservations(
  index: ObservationIndex,
  coverage: Coverage,
  policy: OrphanPolicy,
): Promise<Observation[]> {
  const windows = seenWindows(coverage);
  const byHash = new Map<string, Observation>();
  for (const type of ActionType.options) {
    for (const source of policy.sourcesByType[type]) {
      const seen = windows.get(source);
      if (seen === undefined) continue;
      for (const observation of await readWindows(index, type, source, seen)) {
        const held = byHash.get(observation.contentHash);
        byHash.set(observation.contentHash, held === undefined ? observation : preferred(held, observation));
      }
    }
  }
  return [...byHash.values()].sort(compareObservations);
}
