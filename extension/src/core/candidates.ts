/**
 * Candidate retrieval (docs/grading.md §4; module contract §13 `candidates.ts`). Pure: no I/O, no clock, no
 * randomness (Hard Rule 4). Async only because the injected index is.
 *
 * A candidate for a claim is an observation of the SAME `ActionType`, from a source the policy lists for that type
 * (§6.1 relevant sources: evidence the claim's coverage never reads cannot verify it; grade refuses any other, and a
 * row from another source can still be an orphan, §3), whose `occurredAt` instant lies in the claim window
 * (inclusive at both ends, window.ts). For `calendar.created` it must also have been first seen
 * (the earliest `observedAt` of every observation sharing its `contentHash`) no earlier than
 * `start(p,t) − beforeClaimMin`: an event already on the calendar before the claim cannot verify "created".
 * Observations with the same `contentHash` count once (lowest id, then earliest `observedAt`, kept). Results are
 * ordered by (`occurredAt` instant, id, `contentHash`), and never depend on the order the index returned them in.
 *
 * Split for size: candidates-index.ts (ObservationIndex, the memory index), candidates-assign.ts (§4.3
 * assignment), candidates-time.ts (memoised instants), candidates-error.ts. Import from here. The representative,
 * the candidate order, the relevant-source rule and the first-seen bound live in order.ts, shared with the batch's
 * retrieval (batch-retrieve.ts), orphan discovery (batch-orphans.ts) and grade's own check (grade-guard.ts).
 */
import type { ObservationIndex } from './candidates-index';
import { observedMs, occurredMs } from './candidates-time';
import { compareCandidates, firstSeenFromMs, fromRelevantSource, type Placed, representative } from './order';
import type { Policy } from './policy';
import type { Observation } from './schema';
import { claimWindow, inClaimWindow, type WindowClaim } from './window';

export { CandidatesError, type CandidatesErrorCode } from './candidates-error';
export { counterpartyTokens, createMemoryIndex, type ObservationIndex } from './candidates-index';
export {
  assign,
  type AssignPolicy,
  exclusiveCandidates,
  type FixedPair,
  type ScoredPair,
} from './candidates-assign';

/** The policy fields retrieval reads. A loaded `Policy` satisfies it. */
export type CandidatesPolicy = Pick<Policy, 'windows' | 'sourcesByType'>;

/** One observation per `contentHash`: the kept representative and, for `calendar.created`, its first sighting. */
interface Sighting extends Placed {
  /** The earliest `observedAt` among every observation sharing this `contentHash`; null when not needed. */
  readonly firstSeenMs: number | null;
}

/** Two sightings of one `contentHash`: §4.1's representative (order.ts) and the earliest sighting of both. */
function merge(held: Sighting, next: Sighting): Sighting {
  const firstSeenMs =
    held.firstSeenMs === null || next.firstSeenMs === null
      ? null
      : Math.min(held.firstSeenMs, next.firstSeenMs);
  const kept = representative(held.observation, next.observation) === held.observation ? held : next;
  return { observation: kept.observation, atMs: kept.atMs, firstSeenMs };
}

/**
 * §4.1 candidates of `claim`, read from `index` and filtered exactly (the index may over-return). Empty for
 * a calendar claim without `targetAt`. Ordered by (`occurredAt` instant, id, `contentHash`).
 *
 * Rows are filtered by type, source and window before they are grouped by `contentHash`. Equal content hashes
 * mean equal `source` and `occurredAt` (both are hashed, §10), so a row and its re-sightings are in or out
 * together, and the first-seen rule sees every sighting of an event.
 */
export async function candidates(
  claim: WindowClaim,
  index: ObservationIndex,
  policy: CandidatesPolicy,
): Promise<Observation[]> {
  const window = claimWindow(claim, policy);
  if (window === null) return [];
  const firstSeenFrom = firstSeenFromMs(claim, policy);
  const fetched = await index.byTypeAndBucket(claim.type, window.fromMs, window.toMs);
  const sightings = new Map<string, Sighting>();
  for (const observation of fetched) {
    if (observation.type !== claim.type || !fromRelevantSource(observation, claim.type, policy)) continue;
    const ms = occurredMs(observation);
    if (!inClaimWindow(window, ms)) continue;
    const firstSeenMs = firstSeenFrom === null ? null : observedMs(observation);
    const sighting: Sighting = { observation, atMs: ms, firstSeenMs };
    const held = sightings.get(observation.contentHash);
    sightings.set(observation.contentHash, held === undefined ? sighting : merge(held, sighting));
  }
  return [...sightings.values()]
    .filter((s) => firstSeenFrom === null || (s.firstSeenMs !== null && s.firstSeenMs >= firstSeenFrom))
    .sort(compareCandidates)
    .map((s) => s.observation);
}
