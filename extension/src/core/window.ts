/**
 * Claim windows (docs/grading.md §4.1, §13 `window.ts`). Pure: no clock, no time-zone database, no local-time
 * `Date` methods, no locale (Hard Rule 4). Every bound is an integer number of epoch milliseconds.
 *
 *  - `precisionBounds(claim)`: the closed interval `[start(p,t), end(p,t)]` of the precision unit (minute, hour
 *    or day) containing `t = claimedAt`, computed in `claimedAt`'s OWN UTC offset (its local fields, read from
 *    the ISO text), with `end = claimedAtEnd` when the claim carries one (an adapter's DST-safe next local
 *    midnight), else `start + unit`.
 *  - `claimWindow(claim, policy)`: where a candidate may lie. `calendar.*` claims are centred on the claimed
 *    event start `targetAt` (`± calendarDays`; null without `targetAt`, rule `no_target`); every other type is
 *    `[start − beforeClaimMin, end + afterClaimMin]`.
 */
import { instantMs } from './normalize';
import type { Policy } from './policy';
import type { ActionType, ClaimPrecision } from './schema';
import { MINUTES_PER_HOUR, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './units';

/**
 * The timing fields of a claim. A parsed `Claim` satisfies it (its optional fields are typed `T | undefined`, so
 * these are too); `claimedAtEnd` is §4.1's optional unit end.
 */
export interface WindowClaim {
  readonly type: ActionType;
  readonly claimedAt: string;
  readonly claimedAtPrecision: ClaimPrecision;
  /** §4.1: when present, `end(p,t)`. Adapters set it for `day` precision to the next local midnight. */
  readonly claimedAtEnd?: string | undefined;
  /** The claimed event start of a `calendar.*` claim. */
  readonly targetAt?: string | undefined;
}

/** A closed interval of epoch milliseconds. */
export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Where a candidate's `occurredAt` may lie (inclusive), the edges `timeProximity` measures against (§5.1), and
 * the anchor interval (the precision unit, or `[targetAt, targetAt]` for calendar claims).
 */
export interface ClaimWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly edgeBeforeMs: number;
  readonly edgeAfterMs: number;
  readonly anchor: Interval;
}

/** The policy fields a window reads. A loaded `Policy` satisfies it. */
export type WindowPolicy = Pick<Policy, 'windows'>;

export type WindowErrorCode = 'end_not_after_claimed_at' | 'unsafe_window';

/** A claim whose timing cannot form a window: fail loud rather than grade against a wrong interval (HR6). */
export class WindowError extends Error {
  constructor(readonly code: WindowErrorCode) {
    super(`window: ${code}`);
    this.name = 'WindowError';
  }
}

const UNIT_MS: Readonly<Record<ClaimPrecision, number>> = Object.freeze({
  minute: MS_PER_MINUTE,
  hour: MS_PER_HOUR,
  day: MS_PER_DAY,
});

/** The trailing UTC offset of an ISO timestamp that `instantMs` already accepted. */
const ISO_OFFSET = /(?:Z|(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))$/;

/** §4.1: `calendar.created`, `calendar.updated` and `calendar.deleted` are centred on `targetAt`. */
export function isCalendarType(type: ActionType): boolean {
  return type.startsWith('calendar.');
}

/** The UTC offset written in `iso`, in minutes (`Z` is 0). Call only after `instantMs(iso)` succeeded. */
function writtenOffsetMinutes(iso: string): number {
  const groups = ISO_OFFSET.exec(iso)?.groups;
  if (groups?.sign === undefined) return 0;
  const magnitude = Number(groups.hours) * MINUTES_PER_HOUR + Number(groups.minutes);
  return groups.sign === '-' ? -magnitude : magnitude;
}

/** `value mod unit` in [0, unit), also for instants before 1970. */
function floorMod(value: number, unit: number): number {
  return ((value % unit) + unit) % unit;
}

function checkedSafe(value: number): number {
  if (!Number.isSafeInteger(value)) throw new WindowError('unsafe_window');
  return value;
}

/**
 * The start of the precision unit containing `claimedAt`, in `claimedAt`'s own offset. Exported for the
 * `calendar.created` first-seen rule, which measures from the claim, not from `targetAt`.
 */
export function precisionStartMs(claim: Pick<WindowClaim, 'claimedAt' | 'claimedAtPrecision'>): number {
  const instant = instantMs(claim.claimedAt);
  const shift = writtenOffsetMinutes(claim.claimedAt) * MS_PER_MINUTE;
  const local = instant + shift;
  return local - floorMod(local, UNIT_MS[claim.claimedAtPrecision]) - shift;
}

/**
 * §4.1 `[start(p,t), end(p,t)]`. Throws `NormalizeError` for a timestamp that is not ISO with an offset, and
 * `WindowError('end_not_after_claimed_at')` unless `claimedAtEnd` is strictly after `claimedAt` (the unit must
 * contain `t` and have a length; the same rule as the Claim schema's cross-field check).
 */
export function precisionBounds(claim: WindowClaim): Interval {
  const startMs = precisionStartMs(claim);
  if (claim.claimedAtEnd === undefined) {
    return { startMs, endMs: checkedSafe(startMs + UNIT_MS[claim.claimedAtPrecision]) };
  }
  const endMs = instantMs(claim.claimedAtEnd);
  if (endMs <= instantMs(claim.claimedAt)) throw new WindowError('end_not_after_claimed_at');
  return { startMs, endMs };
}

/**
 * §4.1 claim window, or null for a calendar claim without `targetAt` (graded `no_target`, never matched).
 * Every bound is a safe integer, else `WindowError('unsafe_window')`.
 */
export function claimWindow(claim: WindowClaim, policy: WindowPolicy): ClaimWindow | null {
  if (isCalendarType(claim.type)) {
    if (claim.targetAt === undefined) return null;
    const targetMs = instantMs(claim.targetAt);
    const edgeMs = checkedSafe(policy.windows.calendarDays * MS_PER_DAY);
    return {
      fromMs: checkedSafe(targetMs - edgeMs),
      toMs: checkedSafe(targetMs + edgeMs),
      edgeBeforeMs: edgeMs,
      edgeAfterMs: edgeMs,
      anchor: { startMs: targetMs, endMs: targetMs },
    };
  }
  const anchor = precisionBounds(claim);
  const edgeBeforeMs = checkedSafe(policy.windows.beforeClaimMin * MS_PER_MINUTE);
  const edgeAfterMs = checkedSafe(policy.windows.afterClaimMin * MS_PER_MINUTE);
  return {
    fromMs: checkedSafe(anchor.startMs - edgeBeforeMs),
    toMs: checkedSafe(anchor.endMs + edgeAfterMs),
    edgeBeforeMs,
    edgeAfterMs,
    anchor,
  };
}
