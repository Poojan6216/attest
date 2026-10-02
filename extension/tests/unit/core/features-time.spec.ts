/**
 * Task 1.4: timeProximity (docs/grading.md §5.1, §4.1). Δ is the distance to the precision unit (or to
 * targetAt for calendar claims), 1 within toleranceMin, then (edge − Δ)/(edge − tolerance) to 0 at the window
 * edge, exactly, in integer milliseconds. Times with different UTC offsets compare as instants.
 */
import { describe, expect, it } from 'vitest';

import { features } from '../../../src/core/features';
import { timeProximity } from '../../../src/core/features-time';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import type { Ratio } from '../../../src/core/ratio';
import { claimWindow, type ClaimWindow, type WindowClaim } from '../../../src/core/window';
import defaultPolicyJson from '../../../../policy/default.json';

const text = (value: Ratio): string => `${value.num}/${value.den}`;
const TOLERANCE = DEFAULT_POLICY.windows.toleranceMin;

function windowOf(claim: WindowClaim, policy = DEFAULT_POLICY): ClaimWindow {
  const window = claimWindow(claim, policy);
  if (window === null) throw new Error('expected a claim window');
  return window;
}

const MINUTE_CLAIM: WindowClaim = {
  type: 'email.sent',
  claimedAt: '2026-10-06T14:02:00-04:00',
  claimedAtPrecision: 'minute',
};

/** Unit [14:02, 14:03]; before edge 2 min (14:00), after edge 45 min (14:48); tolerance 1 min. */
const MINUTE_ROWS: readonly (readonly [string, string, string])[] = [
  ['inside the unit', '2026-10-06T14:02:30-04:00', '1/1'],
  ['the unit end (closed)', '2026-10-06T14:03:00-04:00', '1/1'],
  ['Δ = tolerance after (golden 28 c1)', '2026-10-06T14:04:00-04:00', '1/1'],
  ['Δ = tolerance + 1 ms (golden 28 c2)', '2026-10-06T14:04:00.001-04:00', '2639999/2640000'],
  ['Δ = 1 485 600 ms after (golden 29)', '2026-10-06T14:27:45.600-04:00', '23/50'],
  ['the after edge exactly', '2026-10-06T14:48:00-04:00', '0/1'],
  ['past the after edge', '2026-10-06T14:50:00-04:00', '0/1'],
  ['Δ = tolerance before', '2026-10-06T14:01:00-04:00', '1/1'],
  ['Δ = 90 s before (golden 28 c3)', '2026-10-06T14:00:30-04:00', '1/2'],
  ['the before edge exactly (golden 28 c4)', '2026-10-06T14:00:00-04:00', '0/1'],
  ['past the before edge', '2026-10-06T13:00:00-04:00', '0/1'],
  ['another offset, same instant inside', '2026-10-06T18:02:30Z', '1/1'],
  ['another offset, 30 min after the unit', '2026-10-06T11:33:00-07:00', '15/44'],
];

describe('timeProximity: minute precision', () => {
  it.each(MINUTE_ROWS)('%s', (_label, occurredAt, value) => {
    expect(text(timeProximity(windowOf(MINUTE_CLAIM), occurredAt, TOLERANCE))).toBe(value);
  });

  it('golden 12: 23:58 claim, 00:01 next-day observation gives 43/44', () => {
    const claim: WindowClaim = { ...MINUTE_CLAIM, claimedAt: '2026-10-06T23:58:00-07:00' };
    expect(text(timeProximity(windowOf(claim), '2026-10-07T00:01:00-07:00', TOLERANCE))).toBe('43/44');
  });

  it('golden 59: across a DST fall-back the instants decide, not the wall clock', () => {
    const claim: WindowClaim = { ...MINUTE_CLAIM, claimedAt: '2026-11-01T01:58:00-07:00' };
    expect(text(timeProximity(windowOf(claim), '2026-11-01T01:01:00-08:00', TOLERANCE))).toBe('43/44');
  });
});

describe('timeProximity: hour and day precision', () => {
  it('hour precision measures from the whole hour', () => {
    const window = windowOf({
      ...MINUTE_CLAIM,
      claimedAt: '2026-10-06T14:37:00-04:00',
      claimedAtPrecision: 'hour',
    });
    expect(text(timeProximity(window, '2026-10-06T14:00:00-04:00', TOLERANCE))).toBe('1/1');
    expect(text(timeProximity(window, '2026-10-06T15:00:00-04:00', TOLERANCE))).toBe('1/1');
    expect(text(timeProximity(window, '2026-10-06T15:30:00-04:00', TOLERANCE))).toBe('15/44');
  });

  it('day precision covers the local day in the claim offset', () => {
    const window = windowOf({
      ...MINUTE_CLAIM,
      claimedAt: '2026-10-06T09:00:00-04:00',
      claimedAtPrecision: 'day',
    });
    expect(text(timeProximity(window, '2026-10-06T00:00:00-04:00', TOLERANCE))).toBe('1/1');
    expect(text(timeProximity(window, '2026-10-06T23:59:00-04:00', TOLERANCE))).toBe('1/1');
    expect(text(timeProximity(window, '2026-10-07T00:30:00-04:00', TOLERANCE))).toBe('15/44');
  });

  it('claimedAtEnd extends the unit (a 25-hour DST day)', () => {
    const claim: WindowClaim = {
      ...MINUTE_CLAIM,
      claimedAt: '2026-11-01T09:00:00-08:00',
      claimedAtPrecision: 'day',
      claimedAtEnd: '2026-11-02T00:00:00-08:00',
    };
    expect(text(timeProximity(windowOf(claim), '2026-11-01T23:30:00-08:00', TOLERANCE))).toBe('1/1');
  });
});

describe('timeProximity: calendar claims measure from targetAt', () => {
  const CALENDAR: WindowClaim = {
    type: 'calendar.updated',
    claimedAt: '2026-10-06T14:02:00-04:00',
    claimedAtPrecision: 'minute',
    targetAt: '2026-10-09T14:00:00-04:00',
  };

  it.each([
    ['at targetAt', '2026-10-09T14:00:00-04:00', '1/1'],
    ['Δ = tolerance', '2026-10-09T14:01:00-04:00', '1/1'],
    ['a day early (golden 53)', '2026-10-08T14:00:00-04:00', '2880/4319'],
    ['a day late', '2026-10-10T14:00:00-04:00', '2880/4319'],
    ['the window edge, calendarDays away', '2026-10-06T14:00:00-04:00', '0/1'],
    ['2 min inside the edge (near claimedAt)', '2026-10-06T14:02:00-04:00', '2/4319'],
    ['outside the window', '2026-10-05T14:00:00-04:00', '0/1'],
  ] as const)('%s', (_label, occurredAt, value) => {
    expect(text(timeProximity(windowOf(CALENDAR), occurredAt, TOLERANCE))).toBe(value);
  });
});

describe('timeProximity reads its windows from the policy', () => {
  it('a zero tolerance makes 1 ms count; a wider window softens the slope', () => {
    const strict = loadPolicy({
      ...defaultPolicyJson,
      windows: { ...defaultPolicyJson.windows, toleranceMin: 0 },
    });
    expect(text(timeProximity(windowOf(MINUTE_CLAIM, strict), '2026-10-06T14:03:00.001-04:00', 0))).toBe(
      '2699999/2700000',
    );
    const wide = loadPolicy({
      ...defaultPolicyJson,
      windows: { ...defaultPolicyJson.windows, afterClaimMin: 90 },
    });
    expect(text(timeProximity(windowOf(MINUTE_CLAIM, wide), '2026-10-06T14:48:00-04:00', TOLERANCE))).toBe(
      '45/89',
    );
  });

  it('features() reports the value as a display signal', () => {
    const result = features(
      { ...MINUTE_CLAIM, counterparty: 'priya@company.com' },
      { counterparty: 'priya@company.com', occurredAt: '2026-10-06T14:27:45.600-04:00' },
      DEFAULT_POLICY,
    );
    expect(result.signals.timeProximity).toBe(0.46);
  });
});
