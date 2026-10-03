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
import { features, isAssignable, pairScorer } from './features';
import { instantMs } from './normalize';
import type { Policy } from './policy';
import { compareScores, type Ratio, ratioGteBasisPoints, type Score } from './ratio';
import { uniqueRows } from './receipt';
import type { Claim, Coverage, Observation, ObserverCoverage, ReasonCode } from './schema';
import { compareText as compareTextShared } from './order';

export interface VisibleInputs {
  readonly coverage: Coverage;
  /** One per id, in (`occurredAt` instant, id) order. */
  readonly candidates: readonly Observation[];
  /** The same candidates in id order (as `inputsHash` names them, §3). */
  readonly byId: readonly Observation[];
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

/** The one code-unit order (order.ts), bound once: the test transform turns an imported call into a getter. */
const compareText = compareTextShared;

/** The coverage `grade()` sees, remembered per input coverage with what it was filtered from. */
interface VisibleCoverage {
  readonly evaluatedAt: string;
  readonly observers: readonly ObserverCoverage[];
  /** Each input entry and the `lastSyncAt` it had, in input order. */
  readonly entries: readonly ObserverCoverage[];
  readonly syncs: readonly string[];
  readonly visible: Coverage;
}

/**
 * One coverage object is graded with every receipt of a batch; its visible part is built once per object, so the
 * same visible object reaches `inputsHash`, whose `coverageHash` is then computed once per batch (§3). An entry
 * is used only while the coverage still holds the same `evaluatedAt`, the same list and the same entries with
 * the same `lastSyncAt` (all the filter reads), so an object edited in place is filtered again, never stale.
 * The visible object holds the input's own entries, so an edit to any other field shows through it.
 */
const VISIBLE_COVERAGE = new WeakMap<Coverage, VisibleCoverage>();

function sameFilterInputs(coverage: Coverage, held: VisibleCoverage): boolean {
  const { observers } = coverage;
  if (coverage.evaluatedAt !== held.evaluatedAt || observers !== held.observers) return false;
  if (observers.length !== held.entries.length) return false;
  return observers.every((entry, i) => entry === held.entries[i] && entry.lastSyncAt === held.syncs[i]);
}

/** §3: the coverage entries synced by `evaluatedAt`, as one object per input coverage (see above). */
export function visibleCoverage(coverage: Coverage): Coverage {
  const held = VISIBLE_COVERAGE.get(coverage);
  if (held !== undefined && sameFilterInputs(coverage, held)) return held.visible;
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const observers = coverage.observers.filter((entry) => entryInstants(entry).syncMs <= evaluatedMs);
  const visible: Coverage = { evaluatedAt: coverage.evaluatedAt, observers };
  VISIBLE_COVERAGE.set(coverage, {
    evaluatedAt: coverage.evaluatedAt,
    observers: coverage.observers,
    entries: [...coverage.observers],
    syncs: coverage.observers.map((entry) => entry.lastSyncAt),
    visible,
  });
  return visible;
}

function compareIds(a: Observation, b: Observation): number {
  return compareText(a.id, b.id);
}

/** Whether ids repeat in an id-sorted list (repeats are adjacent). */
function repeatsId(byId: readonly Observation[]): boolean {
  return byId.some((observation, i) => i > 0 && byId[i - 1]?.id === observation.id);
}

/** The rows in (`occurredAt` instant, id) order: as given when they already are (a batch hands them so). */
function byOccurrence(rows: Observation[]): Observation[] {
  const keyed = rows.map((observation) => ({ observation, atMs: occurredMs(observation) }));
  const ordered = keyed.every((row, i) => {
    const previous = keyed[i - 1];
    if (previous === undefined) return true;
    return (
      previous.atMs < row.atMs || (previous.atMs === row.atMs && previous.observation.id < row.observation.id)
    );
  });
  if (ordered) return rows;
  return keyed
    .sort((a, b) => a.atMs - b.atMs || compareText(a.observation.id, b.observation.id))
    .map(({ observation }) => observation);
}

/**
 * §3: the inputs as of `coverage.evaluatedAt`, candidates de-duplicated by id, in (occurredAt, id) order and in id
 * order. The candidates are sorted by id once, to find repeated ids (`uniqueRows` keeps one row per id).
 */
export function visibleInputs(candidates: readonly Observation[], coverage: Coverage): VisibleInputs {
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const seen = candidates.filter((candidate) => observedMs(candidate) <= evaluatedMs);
  const sorted = [...seen].sort(compareIds);
  const unique = !repeatsId(sorted);
  const kept = unique ? seen : uniqueRows(seen);
  const byId = unique ? sorted : [...kept].sort(compareIds);
  return { coverage: visibleCoverage(coverage), candidates: byOccurrence(kept), byId };
}

/** The best so far: the higher exact score, ties to the lower observation id (§4.3's tie-break). */
function beats(
  score: Score,
  id: string,
  best: { readonly observation: Observation; readonly score: Score },
): boolean {
  const order = compareScores(score, best.score);
  return order > 0 || (order === 0 && id < best.observation.id);
}

/**
 * §8: the best-scoring candidate of an assignable claim, or null when no candidate was scored. Each pair's score
 * comes from `pairScorer` (valued once per batch: assignment scored the same pairs), compared exactly (§5.3), and
 * only the winner's display signals and reasons are written out (`features`, from the same remembered values).
 */
export function bestCandidate(
  claim: Claim,
  candidates: readonly Observation[],
  policy: Policy,
): BestCandidate | null {
  if (candidates.length === 0 || !isAssignable(claim, policy)) return null;
  const scoreOf = pairScorer(claim, policy);
  let best: { readonly observation: Observation; readonly score: Score } | null = null;
  for (const observation of candidates) {
    const score = scoreOf(observation);
    if (best === null || beats(score, observation.id, best)) best = { observation, score };
  }
  return best === null
    ? null
    : { observation: best.observation, ...features(claim, best.observation, policy) };
}

/** §4.3/§8: the best candidate is assigned iff its score ≥ `thresholds.partial` (exact, in basis points). */
export function assignedOf(best: BestCandidate | null, policy: Policy): Observation | null {
  if (best === null || !ratioGteBasisPoints(best.score, policy.bp.thresholds.partial)) return null;
  return best.observation;
}
