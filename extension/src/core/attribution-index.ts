/**
 * Time lookups for UNASKED attribution (docs/grading.md §7). Every attribution signal asks one question of a
 * set of closed intervals of epoch milliseconds: "is there an interval [s, e] with s ≤ maxStart and
 * e ≥ minEnd?" A session ping or an activity entry at t is the interval [t, t]; a recorded idle period is
 * [from, to]; a claim is its precision unit [start(p,t), end(p,t)] (§4.1). With `evaluatedAt` (§3), activity is
 * cut at its instant (`untilLimit`): a ping after it is dropped, an idle period that straddles it ends at it.
 *
 *  - within ±w of t:             exists(t + w, t − w)
 *  - covers [t − w, t] entirely: exists(t − w, t)
 *
 * The index sorts the intervals by start once and keeps the running maximum of their ends, so each question is
 * one binary search: a batch can attribute every orphan without rescanning the activity (ledger_engineer
 * rule 9). Integer comparisons only; a bound outside the safe-integer range throws instead of being rounded.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import type { Interval } from './window';

export type AttributionErrorCode =
  /** A window bound (`t ± w`) left the safe-integer range, where milliseconds would be rounded (§5.3). */
  'unsafe_window';

/** Attribution input that cannot be read exactly: fail loud rather than attribute on a rounded instant (HR6). */
export class AttributionError extends Error {
  constructor(readonly code: AttributionErrorCode) {
    super(`attribution: ${code}`);
    this.name = 'AttributionError';
  }
}

/** `value`, if it is a safe integer; otherwise throws `AttributionError('unsafe_window')`. */
export function checkedSafe(value: number): number {
  if (!Number.isSafeInteger(value)) throw new AttributionError('unsafe_window');
  return value;
}

/** A set of closed intervals that answers "does any interval start by `maxStart` and end at or after `minEnd`?" */
export interface IntervalIndex {
  exists(maxStart: number, minEnd: number): boolean;
}

/** The number of entries of the ascending `sorted` that are ≤ `value`. */
export function countAtMost(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const item = sorted[middle];
    if (item !== undefined && item <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Builds the index over `intervals` (any order; the input is not modified). */
export function intervalIndex(intervals: readonly Interval[]): IntervalIndex {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const starts = sorted.map((interval) => interval.startMs);
  const maxEnds: number[] = [];
  let running = Number.NEGATIVE_INFINITY;
  for (const interval of sorted) {
    running = Math.max(running, interval.endMs);
    maxEnds.push(running);
  }
  return {
    exists(maxStart, minEnd) {
      const reach = maxEnds[countAtMost(starts, maxStart) - 1];
      return reach !== undefined && reach >= minEnd;
    },
  };
}

/** The point interval [ms, ms]. */
export function point(ms: number): Interval {
  return { startMs: ms, endMs: ms };
}

/**
 * §3: the part of `interval` at or before `limitMs`, or null when it starts after it. An interval that straddles
 * the limit ends at it; a point at or before it is kept as is. Evidence from after `evaluatedAt` is never read.
 */
export function untilLimit(interval: Interval, limitMs: number): Interval | null {
  if (interval.startMs > limitMs) return null;
  return interval.endMs <= limitMs ? interval : { startMs: interval.startMs, endMs: limitMs };
}

/**
 * One index per key, built from `items` grouped by `keyOf`, each interval cut at `limitMs` (`untilLimit`;
 * +∞ keeps every interval whole). A key with no interval left has no index.
 */
export function indexBy<Item, Key>(
  items: readonly Item[],
  keyOf: (item: Item) => Key,
  intervalOf: (item: Item) => Interval,
  limitMs: number = Number.POSITIVE_INFINITY,
): ReadonlyMap<Key, IntervalIndex> {
  const groups = new Map<Key, Interval[]>();
  for (const item of items) {
    const interval = untilLimit(intervalOf(item), limitMs);
    if (interval === null) continue;
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [interval]);
    else group.push(interval);
  }
  return new Map([...groups].map(([key, group]) => [key, intervalIndex(group)]));
}
