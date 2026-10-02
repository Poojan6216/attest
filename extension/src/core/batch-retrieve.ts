/**
 * Batch retrieval (docs/grading.md §4.1, §4.2): the candidates of every assignable claim of a batch, exactly as
 * `candidates()` returns them claim by claim, read type by type instead (the task 1.5 grading perf gate: a
 * calendar event lies in the window of every calendar claim within ±calendarDays of it, so reading claim by claim
 * read, grouped and sorted it hundreds of times).
 *
 * For each type, the claims' windows are merged into disjoint intervals and each interval is read once through
 * the index (every read is bounded in time and never wider than the union of the windows, §4.2). The rows are
 * filtered by type, grouped by `contentHash` and ordered once; each claim's candidates are then the groups whose
 * `occurredAt` lies in its window, in the same order, with the same `calendar.created` first-seen rule. This is
 * `candidates()` exactly because equal content hashes mean equal `occurredAt` (it is hashed, §10): every
 * sighting of an event is in or out of a window together, so grouping within each window and grouping once give
 * the same groups, the same representative (lowest id, then earliest sighting, then the smaller `observedAt`
 * text: a total order) and the same first sighting. If the rows of a type ever break that (one content hash at
 * two instants, which only a corrupt ledger can hold), that type's claims are read claim by claim with
 * `candidates()` itself. A property test pins the two together.
 *
 * Each type's rows become one `CandidateTable` (batch-table.ts) and each claim's candidates a list of row indexes
 * into it, so what grading reads of a row is read once per batch, not once per claim that sees it.
 *
 * PURE: no I/O but the injected index, no clock, no logging (Hard Rule 4). Async only because the index is.
 */
import { CandidateTable } from './batch-table';
import type { TextFacts } from './features';
import { candidates, type ObservationIndex } from './candidates';
import { observedMs, occurredMs } from './candidates-time';
import type { ActionType, Claim, Observation } from './schema';
import { MS_PER_MINUTE } from './units';
import { claimWindow, type Interval, precisionStartMs, type WindowPolicy } from './window';

/** One claim's window and, for `calendar.created`, its first-seen bound (candidates.ts `firstSeenFromMs`). */
interface Wanted {
  readonly claim: Claim;
  readonly fromMs: number;
  readonly toMs: number;
  readonly firstSeenFrom: number | null;
}

/** One `contentHash`: its representative, `occurredAt` instant, and (for `calendar.created`) earliest sighting. */
interface Group {
  observation: Observation;
  readonly occurredMs: number;
  firstSeenMs: number;
}

/** The first-seen rule reads sightings for `calendar.created` only (§4.1). */
function sightedAt(type: ActionType, observation: Observation): number {
  return type === 'calendar.created' ? observedMs(observation) : 0;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** candidates.ts `preferA`: the lower id, then the earlier sighting, then the smaller `observedAt` text. */
function prefer(a: Observation, b: Observation): boolean {
  const order =
    compareText(a.id, b.id) ||
    compareNumbers(observedMs(a), observedMs(b)) ||
    compareText(a.observedAt, b.observedAt);
  return order <= 0;
}

/** candidates.ts `compareSightings`: (`occurredAt` instant, id, `contentHash`). */
function compareGroups(a: Group, b: Group): number {
  return (
    compareNumbers(a.occurredMs, b.occurredMs) ||
    compareText(a.observation.id, b.observation.id) ||
    compareText(a.observation.contentHash, b.observation.contentHash)
  );
}

function byFrom(a: Wanted, b: Wanted): number {
  return a.fromMs - b.fromMs;
}

/** Closed intervals merged where they overlap or touch, in ascending order. */
function mergedIntervals(wanted: readonly Wanted[]): Interval[] {
  const sorted = [...wanted].sort(byFrom);
  const merged: Interval[] = [];
  for (const { fromMs, toMs } of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && fromMs <= last.endMs) {
      merged[merged.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, toMs) };
    } else {
      merged.push({ startMs: fromMs, endMs: toMs });
    }
  }
  return merged;
}

/**
 * Adds the rows of `type` that lie in `interval` to `groups` (by `contentHash`); false as soon as one content hash
 * shows two `occurredAt` instants (then grouping once would not be grouping per window).
 */
function addRows(
  groups: Map<string, Group>,
  type: ActionType,
  { startMs, endMs }: Interval,
  rows: readonly Observation[],
): boolean {
  for (const observation of rows) {
    if (observation.type !== type) continue;
    const atMs = occurredMs(observation);
    if (atMs < startMs || atMs > endMs) continue;
    const held = groups.get(observation.contentHash);
    if (held === undefined) {
      groups.set(observation.contentHash, {
        observation,
        occurredMs: atMs,
        firstSeenMs: sightedAt(type, observation),
      });
      continue;
    }
    if (held.occurredMs !== atMs) return false;
    held.firstSeenMs = Math.min(held.firstSeenMs, sightedAt(type, observation));
    if (!prefer(held.observation, observation)) held.observation = observation;
  }
  return true;
}

/**
 * The rows of `type` read over `intervals`, grouped by `contentHash` and in candidate order; null when one content
 * hash shows two `occurredAt` instants (then grouping once would not be grouping per window).
 */
async function groupsOf(
  type: ActionType,
  intervals: readonly Interval[],
  index: ObservationIndex,
): Promise<Group[] | null> {
  const groups = new Map<string, Group>();
  for (const interval of intervals) {
    const rows = await index.byTypeAndBucket(type, interval.startMs, interval.endMs);
    if (!addRows(groups, type, interval, rows)) return null;
  }
  return [...groups.values()].sort(compareGroups);
}

/** The index of the first group at or after `ms`. */
function firstAtOrAfter(groups: readonly Group[], ms: number): number {
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((groups[middle]?.occurredMs ?? ms) < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** One claim's candidates (`candidates()`, in its order): indexes into its type's table. */
export interface ClaimCandidates {
  readonly table: CandidateTable;
  readonly rows: readonly number[];
}

/** One claim's candidates from its type's groups: those in its window, in order, past the first-seen rule. */
function slice(groups: readonly Group[], wanted: Wanted): number[] {
  const rows: number[] = [];
  for (let i = firstAtOrAfter(groups, wanted.fromMs); i < groups.length; i += 1) {
    const group = groups[i];
    if (group === undefined || group.occurredMs > wanted.toMs) break;
    if (wanted.firstSeenFrom === null || group.firstSeenMs >= wanted.firstSeenFrom) rows.push(i);
  }
  return rows;
}

function wantedOf(claim: Claim, policy: WindowPolicy): Wanted | null {
  const window = claimWindow(claim, policy);
  if (window === null) return null;
  const firstSeenFrom =
    claim.type === 'calendar.created'
      ? precisionStartMs(claim) - policy.windows.beforeClaimMin * MS_PER_MINUTE
      : null;
  return { claim, fromMs: window.fromMs, toMs: window.toMs, firstSeenFrom };
}

/**
 * `candidates()` claim by claim (a type whose rows show one content hash at two instants), as one table of the
 * distinct observations returned and each claim's rows in it.
 */
async function claimByClaim(
  wanted: readonly Wanted[],
  index: ObservationIndex,
  policy: WindowPolicy,
  texts: TextFacts,
): Promise<Map<Claim, ClaimCandidates>> {
  const rowOf = new Map<Observation, number>();
  const lists: [Claim, Observation[]][] = [];
  for (const { claim } of wanted) {
    const found = await candidates(claim, index, policy);
    for (const observation of found) if (!rowOf.has(observation)) rowOf.set(observation, rowOf.size);
    lists.push([claim, found]);
  }
  const rows = [...rowOf.keys()];
  const table = new CandidateTable(rows, rows.map(occurredMs), texts);
  const found = new Map<Claim, ClaimCandidates>();
  for (const [claim, list] of lists) {
    found.set(claim, { table, rows: list.map((observation) => rowOf.get(observation) ?? 0) });
  }
  return found;
}

/**
 * `candidates(claim, index, policy)` for every claim given (in practice the batch's assignable claims), as a map
 * from claim object to its candidates: a table per type and the claim's rows in it. A claim with no window (a
 * calendar claim without `targetAt`) has none. `texts` reads the rows' texts once per batch (under the policy's
 * stop words).
 */
export async function candidatesOfAll(
  claims: readonly Claim[],
  index: ObservationIndex,
  policy: WindowPolicy,
  texts: TextFacts,
): Promise<Map<Claim, ClaimCandidates>> {
  const byType = new Map<ActionType, Wanted[]>();
  const found = new Map<Claim, ClaimCandidates>();
  const none = new CandidateTable([], [], texts);
  for (const claim of claims) {
    const wanted = wantedOf(claim, policy);
    const held = byType.get(claim.type);
    if (wanted === null) found.set(claim, { table: none, rows: [] });
    else if (held === undefined) byType.set(claim.type, [wanted]);
    else held.push(wanted);
  }
  for (const [type, wanted] of byType) {
    const groups = await groupsOf(type, mergedIntervals(wanted), index);
    if (groups === null) {
      for (const [claim, own] of await claimByClaim(wanted, index, policy, texts)) found.set(claim, own);
      continue;
    }
    const rows: Observation[] = [];
    const instants: number[] = [];
    for (const group of groups) {
      rows.push(group.observation);
      instants.push(group.occurredMs);
    }
    const table = new CandidateTable(rows, instants, texts);
    for (const one of wanted) found.set(one.claim, { table, rows: slice(groups, one) });
  }
  return found;
}
