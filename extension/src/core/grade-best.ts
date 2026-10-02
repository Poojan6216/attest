/**
 * What `grade()` sees and the best candidate (docs/grading.md §3, §5, §8). Internal to grade.ts.
 *
 *  - `visibleInputs`: coverage entries with `lastSyncAt > evaluatedAt` and candidates with `observedAt >
 *    evaluatedAt` are dropped (replay at an earlier instant sees exactly what grading saw); candidates are then
 *    one per id and ordered by (`occurredAt` instant, id).
 *  - `bestCandidate`: only an assignable claim is scored (features.ts throws for a claim with no weighted
 *    feature; §4.3 never scores an underspecified, target-less or source-less claim). The best candidate is the
 *    highest exact score, ties broken by the lower observation id, the same tie-break §4.3 assignment uses, so
 *    `match.best` names the assigned candidate whenever one is assigned.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { observedMs, occurredMs } from './candidates-time';
import { entryInstants } from './conditions';
import { features, isAssignable } from './features';
import { instantMs } from './normalize';
import type { Policy } from './policy';
import { compareRatio, type Ratio, ratioGteBasisPoints } from './ratio';
import { uniqueById } from './receipt';
import type { Claim, Coverage, Observation, ReasonCode } from './schema';

export interface VisibleInputs {
  readonly coverage: Coverage;
  readonly candidates: readonly Observation[];
}

export interface BestCandidate {
  readonly observation: Observation;
  /** Exact (§5.3); compare only this. */
  readonly score: Ratio;
  /** Display numbers: the applicable features and `score` (§8 receipt `signals`). */
  readonly signals: Readonly<Record<string, number>>;
  /** The pair's `cp.*` reasons, in §15 order. */
  readonly reasonCodes: readonly ReasonCode[];
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** §3: the inputs as of `coverage.evaluatedAt`, candidates de-duplicated by id and in (occurredAt, id) order. */
export function visibleInputs(candidates: readonly Observation[], coverage: Coverage): VisibleInputs {
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const observers = coverage.observers.filter((entry) => entryInstants(entry).syncMs <= evaluatedMs);
  const seen = uniqueById(candidates.filter((candidate) => observedMs(candidate) <= evaluatedMs));
  const ordered = seen
    .map((observation) => ({ observation, atMs: occurredMs(observation) }))
    .sort((a, b) => a.atMs - b.atMs || compareText(a.observation.id, b.observation.id))
    .map(({ observation }) => observation);
  return { coverage: { evaluatedAt: coverage.evaluatedAt, observers }, candidates: ordered };
}

function beats(score: Ratio, id: string, best: BestCandidate): boolean {
  const order = compareRatio(score, best.score);
  return order > 0 || (order === 0 && id < best.observation.id);
}

/** §8: the best-scoring candidate of an assignable claim, or null when no candidate was scored. */
export function bestCandidate(
  claim: Claim,
  candidates: readonly Observation[],
  policy: Policy,
): BestCandidate | null {
  if (candidates.length === 0 || !isAssignable(claim, policy)) return null;
  let best: BestCandidate | null = null;
  for (const observation of candidates) {
    const result = features(claim, observation, policy);
    if (best === null || beats(result.score, observation.id, best)) best = { observation, ...result };
  }
  return best;
}

/** §4.3/§8: the best candidate is assigned iff its score ≥ `thresholds.partial` (exact, in basis points). */
export function assignedOf(best: BestCandidate | null, policy: Policy): Observation | null {
  if (best === null || !ratioGteBasisPoints(best.score, policy.bp.thresholds.partial)) return null;
  return best.observation;
}
