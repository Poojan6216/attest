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
 *    policy does not list for its type can neither verify a claim nor accuse an agent (Hard Rule 5). A `gcal.event`
 *    row must also be a change Attest saw happen (`followedChange`, §3, §7): a first look at a range reports every
 *    event already there, and none of those is an action anyone took (Hard Rule 7); the first-look marker the ledger
 *    stores with every first sighting (v1.10) is an entry that found its row already there. Batch grading
 *    (`coveredObservations`) and replay (replay.ts, for an UNASKED receipt's observation) both decide with it, so
 *    replay reproduces every UNASKED receipt the batch issues (Hard Rule 4).
 *  - `coveredObservations(index, coverage, policy)`: every orphan candidate, counted once per `contentHash` (§4.1:
 *    the lowest id is kept, then the earliest sighting; order.ts `representative`). These are the observations an
 *    orphan can be (§4.3: assigned to no claim, not taken).
 */
import type { ObservationIndex } from './candidates';
import { occurredMs } from './candidates-time';
import { instantMs } from './normalize';
import {
  compareCandidates,
  compareNumbers,
  firstSeenAt,
  fromRelevantSource,
  mergeIntervals,
  type Placed,
  representative,
} from './order';
import type { Policy } from './policy';
import {
  ActionType,
  type Coverage,
  type Observation,
  type ObservationSource,
  type ObserverCoverage,
} from './schema';
import type { Interval } from './window';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const instantMsLocal = instantMs;
const representativeLocal = representative;
const compareCandidatesLocal = compareCandidates;
const fromRelevantSourceLocal = fromRelevantSource;
const firstSeenAtLocal = firstSeenAt;

/** The policy fields orphan discovery reads. A loaded `Policy` satisfies it. */
export type OrphanPolicy = Pick<Policy, 'sourcesByType'>;

/**
 * One `gcal.event` entry synced by `evaluatedAt`, in epoch ms: its window, its sync, and the instant its comparable
 * snapshots began (`changesSince`), null for an entry that compared nothing (no `changesSince`).
 */
export interface CalendarSpan {
  readonly startMs: number;
  readonly endMs: number;
  readonly syncMs: number;
  /** `changesSince`: the entry followed the window's changes over `[sinceMs, syncMs]`. Null: it followed none. */
  readonly sinceMs: number | null;
}

/** What the observers of a batch saw (`seenWindows`). */
export interface SeenWindows {
  /** Per source, the closed, disjoint, ascending windows its observers saw. */
  readonly bySource: ReadonlyMap<ObservationSource, readonly Interval[]>;
  /**
   * The `gcal.event` entries whose window is longer than an instant, ascending by window start, with `reach[i]` the
   * latest window end of the first i+1.
   */
  readonly calendar: readonly CalendarSpan[];
  readonly reach: readonly number[];
  /**
   * The `gcal.event` entries whose window is one instant (a first-look marker, §3 v1.10), by that instant: a point
   * holds only a row that starts there, so each row reads its own in one lookup, however many markers a batch holds.
   */
  readonly points: ReadonlyMap<number, readonly CalendarSpan[]>;
}

/** The source whose rows are snapshot differences, held to the followed-change rule (`followedChange`). */
const SNAPSHOT_SOURCE: ObservationSource = 'gcal.event';

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

/** A `gcal.event` entry as a `CalendarSpan`. */
function calendarSpan(entry: ObserverCoverage, interval: Interval, syncMs: number): CalendarSpan {
  const { changesSince } = entry;
  return { ...interval, syncMs, sinceMs: changesSince === undefined ? null : instantMsLocal(changesSince) };
}

/**
 * Per source, the union of the windows its observers saw in passes synced by `evaluatedAt` (§3), and the
 * `gcal.event` entries themselves, which the followed-change rule reads one by one (`followedChange`).
 */
export function seenWindows(coverage: Coverage): SeenWindows {
  const evaluatedMs = instantMsLocal(coverage.evaluatedAt);
  const bySource = new Map<ObservationSource, Interval[]>();
  const calendar: CalendarSpan[] = [];
  const points = new Map<number, CalendarSpan[]>();
  for (const entry of coverage.observers) {
    const syncMs = instantMsLocal(entry.lastSyncAt);
    if (syncMs > evaluatedMs) continue;
    const interval = { startMs: instantMsLocal(entry.windowStart), endMs: instantMsLocal(entry.windowEnd) };
    if (entry.source === SNAPSHOT_SOURCE)
      addCalendarSpan(calendar, points, calendarSpan(entry, interval, syncMs));
    const held = bySource.get(entry.source);
    if (held === undefined) bySource.set(entry.source, [interval]);
    else held.push(interval);
  }
  calendar.sort((a, b) => compareNumbers(a.startMs, b.startMs));
  const reach: number[] = [];
  for (const span of calendar) reach.push(Math.max(reach[reach.length - 1] ?? span.endMs, span.endMs));
  const merged = new Map([...bySource].map(([source, intervals]) => [source, mergeIntervals(intervals)]));
  return { bySource: merged, calendar, reach, points };
}

/** Files a `gcal.event` span with the points (a one-instant window) or with the longer windows. */
function addCalendarSpan(
  calendar: CalendarSpan[],
  points: Map<number, CalendarSpan[]>,
  span: CalendarSpan,
): void {
  if (span.startMs !== span.endMs) {
    calendar.push(span);
    return;
  }
  const held = points.get(span.startMs);
  if (held === undefined) points.set(span.startMs, [span]);
  else held.push(span);
}

/** How many of `calendar` (ascending by start) start at or before `atMs`. */
function startedBy(calendar: readonly CalendarSpan[], atMs: number): number {
  let low = 0;
  let high = calendar.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((calendar[middle]?.startMs ?? atMs) <= atMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** What one entry holding a row's start says of a row first seen at `seenMs` (`spanVerdict`). */
type Verdict = 'found' | 'followed' | 'neither';

/**
 * `found`: the entry may have found the row already there (rule (b): it began comparing at the first sighting, or it
 * compared nothing and synced at or after it); `followed`: it followed changes through the first sighting (rule (a));
 * else `neither`. A first-look marker (`changesSince = lastSyncAt` = its row's first sighting, §3 v1.10) is `found`
 * for its row and `neither` for every other: it never follows a change.
 */
function spanVerdict(span: CalendarSpan, seenMs: number): Verdict {
  const { sinceMs, syncMs } = span;
  if (sinceMs === null ? syncMs >= seenMs : sinceMs === seenMs) return 'found';
  return sinceMs !== null && sinceMs < seenMs && seenMs <= syncMs ? 'followed' : 'neither';
}

/**
 * §3, §7: whether a `gcal.event` row whose event starts at `atMs` and that was first seen at `seenMs` is a change
 * Attest saw happen. Over the `gcal.event` entries whose window holds `atMs`:
 *  (a) one followed the window's changes from strictly before the first sighting through it
 *      (`changesSince < seenMs ≤ lastSyncAt`): the event was not there in an earlier comparable snapshot; and
 *  (b) none may have found the row already there: none began comparing at the first sighting itself
 *      (`changesSince = seenMs`, a first look then: a second account's, a restarted range's, or the first-look
 *      marker the ledger stores with every first sighting, v1.10), and none that compared nothing (no
 *      `changesSince`) was synced at or after it (its passes, merged, may include one at the first sighting). Rows
 *      carry no account, so (b) stands in for "its own account" (Hard Rule 7: a first look never accuses an agent).
 * The one-instant entries holding `atMs` are read by lookup (`points`), the longer windows by the `reach` scan.
 */
function followedChange(windows: SeenWindows, atMs: number, seenMs: number): boolean {
  const { calendar, reach, points } = windows;
  let changed = false;
  for (const span of points.get(atMs) ?? []) {
    const verdict = spanVerdict(span, seenMs);
    if (verdict === 'found') return false;
    if (verdict === 'followed') changed = true;
  }
  for (let i = startedBy(calendar, atMs) - 1; i >= 0 && (reach[i] ?? atMs) >= atMs; i -= 1) {
    const span = calendar[i];
    if (span === undefined || span.endMs < atMs) continue;
    const verdict = spanVerdict(span, seenMs);
    if (verdict === 'found') return false;
    if (verdict === 'followed') changed = true;
  }
  return changed;
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
 * no sources lists none), its `occurredAt` lies in a window its own source was seen in, and, for a `gcal.event` row,
 * it is a change Attest saw happen (`followedChange`, read at its first sighting). The only definition: gradeBatch
 * (`coveredObservations`, on the representative of each `contentHash`) and replay (replay.ts, for an UNASKED
 * receipt's observation) both call it.
 */
export function isOrphanCandidate(
  observation: Observation,
  windows: SeenWindows,
  policy: OrphanPolicy,
): boolean {
  const atMs = seenInstant(observation, windows, policy, occurredMs);
  return atMs !== null && sawChange(observation, atMs, windows);
}

/**
 * The part of `isOrphanCandidate` every row sharing a `contentHash` meets alike (source, type and `occurredAt` are
 * content): the observation's `occurredAt` instant (read only once its own source has windows) when its source is
 * listed for its type and was seen at that instant, else null.
 */
function seenInstant(
  observation: Observation,
  windows: SeenWindows,
  policy: OrphanPolicy,
  occurredAtMs: (observation: Observation) => number,
): number | null {
  if (!fromRelevantSourceLocal(observation, observation.type, policy)) return null;
  const own = windows.bySource.get(observation.source);
  if (own === undefined) return null;
  const atMs = occurredAtMs(observation);
  return inWindows(own, atMs) ? atMs : null;
}

/**
 * The part of `isOrphanCandidate` that reads the row's first sighting: a `gcal.event` row must be a change Attest saw
 * happen (`followedChange`); every other row passes. Decided on a `contentHash`'s representative, the first sighting
 * of the fact (§4.1), never on a later re-sighting of an event a first look found already there.
 */
function sawChange(observation: Observation, atMs: number, windows: SeenWindows): boolean {
  if (observation.source !== SNAPSHOT_SOURCE) return true;
  return followedChange(windows, atMs, instantMsLocal(firstSeenAtLocal(observation)));
}

/** `occurredAt` read from its text (see `seenBy`). */
const occurredAtText = (observation: Observation): number => instantMsLocal(observation.occurredAt);

/** Adds the rows of `type` whose own source saw them (`seenInstant`) to `found`, with their instant. */
function keepSeen(
  found: Keyed[],
  rows: readonly Observation[],
  type: ActionType,
  windows: SeenWindows,
  policy: OrphanPolicy,
): void {
  for (const observation of rows) {
    if (observation.type !== type) continue;
    const atMs = seenInstant(observation, windows, policy, occurredAtText);
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
 * windows of the sources the policy lists for it, then each row is held to its own source's windows; the
 * representative of each `contentHash` (§4.1: its first sighting) is then held to the followed-change rule
 * (`sawChange`). `index` should already be `visibleAt(evaluatedAt)`.
 */
export async function coveredObservations(
  index: ObservationIndex,
  coverage: Coverage,
  policy: OrphanPolicy,
): Promise<Keyed[]> {
  const windows = seenWindows(coverage);
  const byHash = new Map<string, Keyed>();
  for (const type of ActionType.options) {
    const sources = policy.sourcesByType[type];
    const union = mergeIntervals(sources.flatMap((source) => windows.bySource.get(source) ?? []));
    if (union.length > 0) addOnce(byHash, await readWindows(index, type, windows, union, policy));
  }
  const changed = [...byHash.values()].filter((row) => sawChange(row.observation, row.atMs, windows));
  return changed.sort(compareCandidatesLocal);
}
