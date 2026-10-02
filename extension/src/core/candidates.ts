/**
 * Candidate retrieval (docs/grading.md §4; module contract §13 `candidates.ts`). Pure: no I/O, no clock, no
 * randomness (Hard Rule 4). Async only because the injected index is.
 *
 * A candidate for a claim is an observation of the SAME `ActionType` whose `occurredAt` instant lies in the
 * claim window (inclusive at both ends, window.ts). For `calendar.created` it must also have been first seen
 * (the earliest `observedAt` of every observation sharing its `contentHash`) no earlier than
 * `start(p,t) − beforeClaimMin`: an event already on the calendar before the claim cannot verify "created".
 * Observations with the same `contentHash` count once (lowest id, then earliest `observedAt`, kept). Results are
 * ordered by (`occurredAt` instant, id, `contentHash`), and never depend on the order the index returned them in.
 *
 * Split for size: candidates-index.ts (ObservationIndex, the memory index), candidates-assign.ts (§4.3
 * assignment), candidates-time.ts (memoised instants), candidates-error.ts. Import from here.
 */
import type { ObservationIndex } from './candidates-index';
import { observedMs, occurredMs } from './candidates-time';
import type { Observation } from './schema';
import { MS_PER_MINUTE } from './units';
import { claimWindow, precisionStartMs, type WindowClaim, type WindowPolicy } from './window';

export { CandidatesError, type CandidatesErrorCode } from './candidates-error';
export { counterpartyTokens, createMemoryIndex, type ObservationIndex } from './candidates-index';
export {
  assign,
  type AssignPolicy,
  exclusiveCandidates,
  type FixedPair,
  type ScoredPair,
} from './candidates-assign';

/** One observation per `contentHash`: the kept representative and, for `calendar.created`, its first sighting. */
interface Sighting {
  readonly observation: Observation;
  readonly occurredMs: number;
  /** The earliest `observedAt` among every observation sharing this `contentHash`; null when not needed. */
  readonly firstSeenMs: number | null;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * The representative of two observations with one `contentHash`: the lower id; on an id tie (the same row seen
 * twice) the earlier sighting, then the smaller `observedAt` text. A total order, so the choice never depends
 * on the index's return order (the candidates are hashed into `inputsHash`, §3).
 */
function preferA(a: Observation, b: Observation): boolean {
  const order =
    compareText(a.id, b.id) ||
    compareNumbers(observedMs(a), observedMs(b)) ||
    compareText(a.observedAt, b.observedAt);
  return order <= 0;
}

function merge(held: Sighting, next: Sighting): Sighting {
  const firstSeenMs =
    held.firstSeenMs === null || next.firstSeenMs === null
      ? null
      : Math.min(held.firstSeenMs, next.firstSeenMs);
  const kept = preferA(held.observation, next.observation) ? held : next;
  return { observation: kept.observation, occurredMs: kept.occurredMs, firstSeenMs };
}

/**
 * The `calendar.created` first-seen bound (§4.1 v1.3): `observedAt ≥ start(p,t) − beforeClaimMin` (equal to
 * `claimedAt − beforeClaimMin` for a unit-aligned claim; a day-precision "yesterday" claim must not reject an
 * event first seen that morning). Null for every other type.
 */
function firstSeenFromMs(claim: WindowClaim, policy: WindowPolicy): number | null {
  if (claim.type !== 'calendar.created') return null;
  return precisionStartMs(claim) - policy.windows.beforeClaimMin * MS_PER_MINUTE;
}

/**
 * (`occurredAt` instant, id), then `contentHash`: unique per sighting after dedupe, so the order is total even
 * for two rows sharing an id with different content (a corrupt or doctored ledger: ids derive from content
 * hashes, §10, but nothing enforces it on input), and never falls back to the index's return order.
 */
function compareSightings(a: Sighting, b: Sighting): number {
  return (
    compareNumbers(a.occurredMs, b.occurredMs) ||
    compareText(a.observation.id, b.observation.id) ||
    compareText(a.observation.contentHash, b.observation.contentHash)
  );
}

/**
 * §4.1 candidates of `claim`, read from `index` and filtered exactly (the index may over-return). Empty for
 * a calendar claim without `targetAt`. Ordered by (`occurredAt` instant, id, `contentHash`).
 *
 * Rows are filtered by type and window before they are grouped by `contentHash`. Equal content hashes mean
 * equal `occurredAt` (it is hashed, §10), so a row and its re-sightings are in or out of the window together,
 * and the first-seen rule sees every sighting of an event.
 */
export async function candidates(
  claim: WindowClaim,
  index: ObservationIndex,
  policy: WindowPolicy,
): Promise<Observation[]> {
  const window = claimWindow(claim, policy);
  if (window === null) return [];
  const firstSeenFrom = firstSeenFromMs(claim, policy);
  const fetched = await index.byTypeAndBucket(claim.type, window.fromMs, window.toMs);
  const sightings = new Map<string, Sighting>();
  for (const observation of fetched) {
    if (observation.type !== claim.type) continue;
    const ms = occurredMs(observation);
    if (ms < window.fromMs || ms > window.toMs) continue;
    const firstSeenMs = firstSeenFrom === null ? null : observedMs(observation);
    const sighting: Sighting = { observation, occurredMs: ms, firstSeenMs };
    const held = sightings.get(observation.contentHash);
    sightings.set(observation.contentHash, held === undefined ? sighting : merge(held, sighting));
  }
  return [...sightings.values()]
    .filter((s) => firstSeenFrom === null || (s.firstSeenMs !== null && s.firstSeenMs >= firstSeenFrom))
    .sort(compareSightings)
    .map((s) => s.observation);
}
