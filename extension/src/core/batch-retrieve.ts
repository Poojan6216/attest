/**
 * Batch retrieval (docs/grading.md §4.1, §4.2): the candidates of every assignable claim of a batch, exactly as
 * `candidates()` returns them claim by claim, read type by type instead (the task 1.5 grading perf gate: a
 * calendar event lies in the window of every calendar claim within ±calendarDays of it, so reading claim by claim
 * read, grouped and sorted it hundreds of times).
 *
 * For each type, the claims' windows are merged into disjoint intervals and each interval is read once through
 * the index (every read is bounded in time and never wider than the union of the windows, §4.2). The rows are
 * filtered by type and relevant source, grouped by `contentHash` and ordered once; each claim's candidates are then
 * the groups whose `occurredAt` lies in its window, in the same order, with the same first-seen rule. This is
 * `candidates()` exactly because equal content hashes mean equal `occurredAt` (it is hashed, §10): every
 * sighting of an event is in or out of a window together, so grouping within each window and grouping once give
 * the same groups, the same representative (lowest id, then earliest sighting, then the smaller `observedAt`
 * text: a total order) and the same first sighting. If the rows of a type ever break that (one content hash at
 * two instants, which only a corrupt ledger can hold), that type's claims are read claim by claim with
 * `candidates()` itself. A property test pins the two together. The representative, the candidate order, the
 * interval merge, the first-seen bound and its comparison (`passesFirstSeen`) are order.ts's: the very functions
 * `candidates()` uses.
 *
 * Each type's rows become one `CandidateTable` (batch-table.ts) and each claim's candidates a list of row indexes
 * into it, so what grading reads of a row is read once per batch, not once per claim that sees it.
 *
 * PURE: no I/O but the injected index, no clock, no logging (Hard Rule 4). Async only because the index is.
 */
import { CandidateTable } from './batch-table';
import type { TextFacts } from './features';
import { candidates, type CandidatesPolicy, type ObservationIndex } from './candidates';
import { occurredMs } from './candidates-time';
import { instantMs } from './normalize';
import {
  compareCandidates,
  firstSeenFromMs,
  fromRelevantSource,
  hasFirstSeenRule,
  mergeIntervals,
  passesFirstSeen,
  representative,
} from './order';
import type { ActionType, Claim, Observation } from './schema';
import { claimWindow, type Interval } from './window';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const instantMsLocal = instantMs;
const representativeLocal = representative;
const fromRelevantSourceLocal = fromRelevantSource;
const hasFirstSeenRuleLocal = hasFirstSeenRule;
const passesFirstSeenLocal = passesFirstSeen;

/** One claim's window and, for `calendar.created`, its first-seen bound (order.ts `firstSeenFromMs`). */
interface Wanted {
  readonly claim: Claim;
  readonly fromMs: number;
  readonly toMs: number;
  readonly firstSeenFrom: number | null;
}

/** One `contentHash`: its representative, `occurredAt` instant, and (for `calendar.created`) earliest sighting. */
interface Group {
  observation: Observation;
  readonly atMs: number;
  firstSeenMs: number;
}

/**
 * A row's sighting, read only for a type with the first-seen rule (§4.1, order.ts `hasFirstSeenRule`). Instants are
 * read from the text, here and in `addRows`, not through the per-object memo (batch-orphans.ts `seenBy`).
 */
function sightedAt(type: ActionType, observation: Observation): number {
  return hasFirstSeenRuleLocal(type) ? instantMsLocal(observation.observedAt) : 0;
}

/** Each claim's window as an interval, merged where they overlap or touch (order.ts `mergeIntervals`). */
function mergedWindows(wanted: readonly Wanted[]): Interval[] {
  return mergeIntervals(wanted.map(({ fromMs, toMs }) => ({ startMs: fromMs, endMs: toMs })));
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
  policy: CandidatesPolicy,
): boolean {
  for (const observation of rows) {
    if (observation.type !== type || !fromRelevantSourceLocal(observation, type, policy)) continue;
    const atMs = instantMsLocal(observation.occurredAt);
    if (atMs < startMs || atMs > endMs) continue;
    const held = groups.get(observation.contentHash);
    if (held === undefined) {
      groups.set(observation.contentHash, { observation, atMs, firstSeenMs: sightedAt(type, observation) });
      continue;
    }
    if (held.atMs !== atMs) return false;
    held.firstSeenMs = Math.min(held.firstSeenMs, sightedAt(type, observation));
    held.observation = representativeLocal(held.observation, observation);
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
  policy: CandidatesPolicy,
): Promise<Group[] | null> {
  const groups = new Map<string, Group>();
  for (const interval of intervals) {
    const rows = await index.byTypeAndBucket(type, interval.startMs, interval.endMs);
    if (!addRows(groups, type, interval, rows, policy)) return null;
  }
  return [...groups.values()].sort(compareCandidates);
}

/** The index of the first group at or after `ms`. */
function firstAtOrAfter(groups: readonly Group[], ms: number): number {
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((groups[middle]?.atMs ?? ms) < ms) low = middle + 1;
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
    if (group === undefined || group.atMs > wanted.toMs) break;
    if (passesFirstSeenLocal(group.firstSeenMs, wanted.firstSeenFrom)) rows.push(i);
  }
  return rows;
}

function wantedOf(claim: Claim, policy: CandidatesPolicy): Wanted | null {
  const window = claimWindow(claim, policy);
  if (window === null) return null;
  return { claim, fromMs: window.fromMs, toMs: window.toMs, firstSeenFrom: firstSeenFromMs(claim, policy) };
}

/**
 * `candidates()` claim by claim (a type whose rows show one content hash at two instants), as one table of the
 * distinct observations returned and each claim's rows in it.
 */
async function claimByClaim(
  wanted: readonly Wanted[],
  index: ObservationIndex,
  policy: CandidatesPolicy,
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
  policy: CandidatesPolicy,
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
    const groups = await groupsOf(type, mergedWindows(wanted), index, policy);
    if (groups === null) {
      for (const [claim, own] of await claimByClaim(wanted, index, policy, texts)) found.set(claim, own);
      continue;
    }
    const rows: Observation[] = [];
    const instants: number[] = [];
    for (const group of groups) {
      rows.push(group.observation);
      instants.push(group.atMs);
    }
    const table = new CandidateTable(rows, instants, texts);
    for (const one of wanted) found.set(one.claim, { table, rows: slice(groups, one) });
  }
  return found;
}
