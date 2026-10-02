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
 * `timeProximityAt` as two integers (not reduced): the shared constants for 1 and 0, else `(edge − Δ) / (edge −
 * tolerance)` in ms. Every operand is a safe integer (window.ts checks the bounds), so nothing here rounds.
 */
export function timeProximityValue(window: ClaimWindow, at: number, toleranceMin: number): NumberRatio {
  const { anchor } = window;
  const before = at < anchor.startMs;
  const deltaMs = before ? anchor.startMs - at : Math.max(at - anchor.endMs, 0);
  const edgeMs = before ? window.edgeBeforeMs : window.edgeAfterMs;
  const toleranceMs = toleranceMin * MS_PER_MINUTE;
  if (deltaMs <= toleranceMs) return NUMBER_RATIO_ONE;
  // The loader keeps toleranceMin below every edge (§5.1); at or past the edge the value is 0, so the
  // denominator below is always positive.
  if (deltaMs >= edgeMs) return NUMBER_RATIO_ZERO;
  return { num: edgeMs - deltaMs, den: edgeMs - toleranceMs };
}
