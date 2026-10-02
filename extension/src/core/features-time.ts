/**
 * The `timeProximity` feature (docs/grading.md §5.1), as an exact rational. Internal to features.ts.
 *
 * Δ is the distance in ms from the observation's `occurredAt` to the claim window's anchor (the precision
 * unit `[start(p,t), end(p,t)]`, or `[targetAt, targetAt]` for a calendar claim; window.ts), 0 inside it. The
 * edge is the window's length on Δ's side (`beforeClaimMin` before, `afterClaimMin` after, `calendarDays` on
 * both sides for calendar). The value is 1 while Δ ≤ `toleranceMin`, then falls linearly to 0 at the edge:
 * `(edge − Δ) / (edge − tolerance)`, all in integer milliseconds. Outside the window it is 0.
 *
 * PURE: no clock, no local time, no I/O (Hard Rule 4).
 */
import { instantMs } from './normalize';
import { NUMBER_RATIO_ONE, NUMBER_RATIO_ZERO, type NumberRatio, type Ratio, ratioOf } from './ratio';
import { MS_PER_MINUTE } from './units';
import type { ClaimWindow } from './window';

/** §5.1 timeProximity of an observation at `occurredAt` (ISO with offset) to a claim window. */
export function timeProximity(window: ClaimWindow, occurredAt: string, toleranceMin: number): Ratio {
  return timeProximityAt(window, instantMs(occurredAt), toleranceMin);
}

/** `timeProximity` of an observation whose `occurredAt` instant is `at` (epoch ms). */
export function timeProximityAt(window: ClaimWindow, at: number, toleranceMin: number): Ratio {
  return ratioOf(timeProximityValue(window, at, toleranceMin));
}

/**
 * `timeProximityAt` as two integers (not reduced) written to `nums[i]` and `dens[i]`: 1/1 and 0/1, else `(edge − Δ) /
 * (edge − tolerance)` in ms. Every operand is a safe integer (window.ts checks the bounds), so nothing here rounds.
 * Returns which: 1 or 0 (the value), or -1 for the fraction.
 */
export function timeProximityInto(
  window: ClaimWindow,
  at: number,
  toleranceMin: number,
  nums: Float64Array,
  dens: Float64Array,
  i: number,
): number {
  const { anchor } = window;
  const before = at < anchor.startMs;
  const deltaMs = before ? anchor.startMs - at : Math.max(at - anchor.endMs, 0);
  const edgeMs = before ? window.edgeBeforeMs : window.edgeAfterMs;
  const toleranceMs = toleranceMin * MS_PER_MINUTE;
  dens[i] = 1;
  if (deltaMs <= toleranceMs) {
    nums[i] = 1;
    return 1;
  }
  // The loader keeps toleranceMin below every edge (§5.1); at or past the edge the value is 0, so the
  // denominator below is always positive.
  if (deltaMs >= edgeMs) {
    nums[i] = 0;
    return 0;
  }
  nums[i] = edgeMs - deltaMs;
  dens[i] = edgeMs - toleranceMs;
  return -1;
}

/** `timeProximityInto`'s output for `timeProximityValue`, written and read within one call. */
const NUM = new Float64Array([0]);
const DEN = new Float64Array([1]);

/** `timeProximityAt` as two integers (not reduced): the shared constants for 1 and 0, else the fraction. */
export function timeProximityValue(window: ClaimWindow, at: number, toleranceMin: number): NumberRatio {
  const which = timeProximityInto(window, at, toleranceMin, NUM, DEN, 0);
  if (which === 1) return NUMBER_RATIO_ONE;
  if (which === 0) return NUMBER_RATIO_ZERO;
  return { num: NUM[0] ?? 0, den: DEN[0] ?? 1 };
}
