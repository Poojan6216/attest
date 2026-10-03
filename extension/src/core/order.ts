/**
 * The orders and §4.1 rules that candidate retrieval (candidates.ts), batch retrieval (batch-retrieve.ts) and orphan
 * discovery (batch-orphans.ts) share, written once so the three can never disagree (docs/grading.md §3, §4.1; Hard
 * Rule 4: replay rebuilds a batch with `candidates()` and must see what the batch's fast path saw).
 *
 *  - `compareText`, `compareNumbers`: total orders on strings (code units, never locale) and numbers.
 *  - `firstSeenAt`, `firstSeenMs`: when an observation was first seen (§3, §4.1): its `sightedAt` when the ledger
 *    stored it later than the observer sighted it, else its `observedAt`. The one reading of a first sighting: the
 *    first-seen rule, the representative, the calendar anchor of §7 and the ledger's `late_sighting` all use it,
 *    while `observedAt` alone decides which batches read the row (§3).
 *  - `representative(a, b)`: which of two observations sharing a `contentHash` counts (§4.1): the lower id, then the
 *    earlier first sighting, then the earlier `observedAt`, then the smaller `observedAt` and `sightedAt` texts. A
 *    total order, so the choice never depends on the order an index returned rows in.
 *  - `compareCandidates`: the candidate order (§4.1): `occurredAt` instant, then id, then `contentHash`. Unique per
 *    sighting after dedupe, so total even for two rows sharing an id with different content (a corrupt ledger).
 *  - `mergeIntervals`: closed intervals merged where they overlap or touch, ascending.
 *  - `hasFirstSeenRule`, `firstSeenFromMs`, `passesFirstSeen`: whether a type has §4.1's first-seen rule
 *    (`calendar.created` only), its bound for a claim (null for every other type), and the one comparison of a first
 *    sighting with that bound (candidates.ts, batch-retrieve.ts and grade-guard.ts all call it).
 *  - `anchorAt`: the §7 anchor of an orphan (attribution.ts and conditions-finality.ts both call it): its first
 *    sighting for `calendar.*`, else its `occurredAt`.
 *  - `fromRelevantSource`: whether the policy lists an observation's source for a type (§6.1 relevant sources). A
 *    claim's candidates come from its type's relevant sources only: evidence the claim's coverage never reads cannot
 *    verify it (grade-guard.ts refuses any other candidate). Orphans obey the same rule (§3, batch-orphans.ts
 *    `isOrphanCandidate`): a row from another source neither verifies a claim nor accuses an agent.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { observedMs, sightedMs } from './candidates-time';
import type { Policy } from './policy';
import type { ActionType, Observation } from './schema';
import { MS_PER_MINUTE } from './units';
import {
  type Interval,
  isCalendarType,
  precisionStartMs,
  type WindowClaim,
  type WindowPolicy,
} from './window';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const observedMsLocal = observedMs;
const sightedMsLocal = sightedMs;

export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The fields that say when an observation was seen. A parsed `Observation` satisfies it. */
export interface Seen {
  readonly observedAt: string;
  readonly sightedAt?: string | undefined;
}

/**
 * §3, §4.1: when `observation` was first seen, as written: its `sightedAt` (the observer's sighting, kept by the
 * ledger when it stored the row later), else its `observedAt` (an absent `sightedAt` means the same instant).
 */
export function firstSeenAt(observation: Seen): string {
  return observation.sightedAt ?? observation.observedAt;
}

/** `firstSeenAt(observation)` as epoch ms, parsed once per object and text (candidates-time.ts). */
export function firstSeenMs(observation: Observation): number {
  return sightedMsLocal(observation, firstSeenAt(observation));
}

/** §4.1's representative of two observations with one `contentHash`: `a` unless `b` comes strictly first. */
export function representative(a: Observation, b: Observation): Observation {
  const order =
    compareText(a.id, b.id) ||
    compareNumbers(firstSeenMs(a), firstSeenMs(b)) ||
    compareNumbers(observedMsLocal(a), observedMsLocal(b)) ||
    compareText(a.observedAt, b.observedAt) ||
    compareText(a.sightedAt ?? '', b.sightedAt ?? '');
  return order <= 0 ? a : b;
}

/** An observation and its `occurredAt` instant (epoch ms), read once. */
export interface Placed {
  readonly observation: Observation;
  readonly atMs: number;
}

/** The §4.1 candidate order: (`occurredAt` instant, id, `contentHash`). */
export function compareCandidates(a: Placed, b: Placed): number {
  return (
    compareNumbers(a.atMs, b.atMs) ||
    compareText(a.observation.id, b.observation.id) ||
    compareText(a.observation.contentHash, b.observation.contentHash)
  );
}

/** Closed intervals merged where they overlap or touch, in ascending order. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
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

/** §6.1 relevant sources: whether the policy lists `observation`'s source for claims of `type`. */
export function fromRelevantSource(
  observation: Pick<Observation, 'source'>,
  type: ActionType,
  policy: Pick<Policy, 'sourcesByType'>,
): boolean {
  return policy.sourcesByType[type].includes(observation.source);
}

/**
 * Whether candidates of `type` must pass §4.1's first-seen rule (an event already on the calendar before the claim
 * cannot verify "created"): `calendar.created` only. Retrieval tracks first sightings for these types alone.
 */
export function hasFirstSeenRule(type: ActionType): boolean {
  return type === 'calendar.created';
}

/**
 * The first-seen bound (§4.1 v1.3) of a claim whose type `hasFirstSeenRule`: a candidate's earliest sighting must be
 * at or after `start(p,t) − beforeClaimMin` (equal to `claimedAt − beforeClaimMin` for a unit-aligned claim; a
 * day-precision "yesterday" claim must not reject an event first seen that morning). Null for every other type.
 */
export function firstSeenFromMs(claim: WindowClaim, policy: WindowPolicy): number | null {
  if (!hasFirstSeenRule(claim.type)) return null;
  return precisionStartMs(claim) - policy.windows.beforeClaimMin * MS_PER_MINUTE;
}

/**
 * §4.1's first-seen rule: whether a candidate first seen at `seenMs` (the earliest `firstSeenMs` of its
 * `contentHash`) passes the bound `firstSeenFromMs` gave: always when there is no bound, else when first seen at or
 * after it.
 */
export function passesFirstSeen(seenMs: number, bound: number | null): boolean {
  return bound === null || seenMs >= bound;
}

/** The orphan fields the §7 anchor reads. A parsed `Observation` satisfies it. */
export interface Anchored extends Seen {
  readonly type: ActionType;
  readonly occurredAt: string;
}

/**
 * §7: the instant, as written, every attribution window of `orphan` and its UNASKED finality are measured from:
 * when the change was first seen (`firstSeenAt`) for a `calendar.*` observation, not the event start; its
 * `occurredAt` for every other type.
 */
export function anchorAt(orphan: Anchored): string {
  return isCalendarType(orphan.type) ? firstSeenAt(orphan) : orphan.occurredAt;
}
