/**
 * window.ts (docs/grading.md §4.1): precision units in the claim's own offset, claimedAtEnd on 23- and 25-hour
 * DST days, midnight crossings, calendar windows on targetAt, and null without targetAt. Expected instants are
 * computed with Date.parse on hand-written ISO strings (an independent oracle), never with window.ts helpers.
 */
import { describe, expect, it } from 'vitest';

import { idFromHash, sha256Hex } from '../../../src/core/hash';
import { NormalizeError } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { type ActionType, Claim, type ClaimPrecision } from '../../../src/core/schema';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../../../src/core/units';
import {
  claimWindow,
  isCalendarType,
  precisionBounds,
  type WindowClaim,
  WindowError,
  type WindowPolicy,
} from '../../../src/core/window';

const at = (iso: string): number => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`bad test ISO ${iso}`);
  return ms;
};

const claim = (
  claimedAt: string,
  claimedAtPrecision: ClaimPrecision = 'minute',
  extra: Partial<WindowClaim> = {},
): WindowClaim => ({ type: 'email.sent', claimedAt, claimedAtPrecision, ...extra });

const withWindows = (windows: Partial<WindowPolicy['windows']>): WindowPolicy => ({
  windows: { ...DEFAULT_POLICY.windows, ...windows },
});

/** [claimedAt, precision, expected unit start, expected unit end] — the end is start + unit in every row. */
const UNIT_ROWS: readonly (readonly [string, ClaimPrecision, string, string])[] = [
  ['2026-10-06T14:02:00-04:00', 'minute', '2026-10-06T14:02:00-04:00', '2026-10-06T14:03:00-04:00'],
  ['2026-10-06T14:02:37.250-04:00', 'minute', '2026-10-06T14:02:00-04:00', '2026-10-06T14:03:00-04:00'],
  ['2026-10-06T14:02:59.999999999Z', 'minute', '2026-10-06T14:02:00Z', '2026-10-06T14:03:00Z'],
  ['2026-10-05T16:40:00-04:00', 'hour', '2026-10-05T16:00:00-04:00', '2026-10-05T17:00:00-04:00'],
  // A half-hour offset: the hour is local (14:00+05:30), not the UTC hour (08:00Z = 13:30+05:30).
  ['2026-10-05T14:20:00+05:30', 'hour', '2026-10-05T14:00:00+05:30', '2026-10-05T15:00:00+05:30'],
  ['2026-10-05T00:10:00+05:45', 'hour', '2026-10-05T00:00:00+05:45', '2026-10-05T01:00:00+05:45'],
  ['2026-10-05T12:00:00-04:00', 'day', '2026-10-05T00:00:00-04:00', '2026-10-06T00:00:00-04:00'],
  // +14:00: the local day starts at 10:00Z the day before; a UTC day would be wrong by 14 hours.
  ['2026-10-05T01:00:00+14:00', 'day', '2026-10-05T00:00:00+14:00', '2026-10-06T00:00:00+14:00'],
  ['2026-10-05T23:59:59-09:30', 'day', '2026-10-05T00:00:00-09:30', '2026-10-06T00:00:00-09:30'],
  ['2026-10-05T23:59:59Z', 'day', '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'],
  // Midnight itself starts its unit.
  ['2026-10-06T00:00:00-04:00', 'day', '2026-10-06T00:00:00-04:00', '2026-10-07T00:00:00-04:00'],
  // Units that end at the next local midnight, in positive and negative offsets (and across a year end).
  ['2026-10-06T23:59:30+05:30', 'minute', '2026-10-06T23:59:00+05:30', '2026-10-07T00:00:00+05:30'],
  ['2026-10-06T23:10:00+09:00', 'hour', '2026-10-06T23:00:00+09:00', '2026-10-07T00:00:00+09:00'],
  ['2026-10-06T23:45:00-03:30', 'hour', '2026-10-06T23:00:00-03:30', '2026-10-07T00:00:00-03:30'],
  ['2026-12-31T23:59:59.999-11:00', 'day', '2026-12-31T00:00:00-11:00', '2027-01-01T00:00:00-11:00'],
  ['2027-01-01T00:00:00+14:00', 'minute', '2027-01-01T00:00:00+14:00', '2027-01-01T00:01:00+14:00'],
  // -00:00 is UTC: the day is the UTC day.
  ['2026-10-06T23:59:30-00:00', 'day', '2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z'],
  // Before 1970 the floor still goes down, never towards zero.
  ['1969-12-31T23:59:30Z', 'minute', '1969-12-31T23:59:00Z', '1970-01-01T00:00:00Z'],
  ['1969-07-20T20:17:40-04:00', 'day', '1969-07-20T00:00:00-04:00', '1969-07-21T00:00:00-04:00'],
];

describe('precisionBounds: the unit containing claimedAt, in its own offset', () => {
  it.each(UNIT_ROWS)('%s at %s precision → [%s, %s]', (claimedAt, precision, start, end) => {
    expect(precisionBounds(claim(claimedAt, precision))).toEqual({ startMs: at(start), endMs: at(end) });
  });

  it('is a closed interval: a minute claim at 14:02 includes 14:03:00.000 as its end', () => {
    const { startMs, endMs } = precisionBounds(claim('2026-10-06T14:02:00-04:00'));
    expect(endMs - startMs).toBe(MS_PER_MINUTE);
  });

  it('throws NormalizeError for a timestamp without an offset (local time is never assumed)', () => {
    expect(() => precisionBounds(claim('2026-10-06T14:02:00'))).toThrow(NormalizeError);
  });
});

describe('precisionBounds: claimedAtEnd replaces start + unit', () => {
  it('23-hour day (US spring forward, 2026-03-08): the unit is exactly 23 h', () => {
    const bounds = precisionBounds(
      claim('2026-03-08T00:00:00-05:00', 'day', { claimedAtEnd: '2026-03-09T00:00:00-04:00' }),
    );
    expect(bounds).toEqual({ startMs: at('2026-03-08T05:00:00Z'), endMs: at('2026-03-09T04:00:00Z') });
    expect(bounds.endMs - bounds.startMs).toBe(23 * MS_PER_HOUR);
  });

  it('25-hour day (US fall back, 2026-11-01): the unit is exactly 25 h, not cut at start + 24 h', () => {
    const bounds = precisionBounds(
      claim('2026-11-01T00:00:00-04:00', 'day', { claimedAtEnd: '2026-11-02T00:00:00-05:00' }),
    );
    expect(bounds).toEqual({ startMs: at('2026-11-01T04:00:00Z'), endMs: at('2026-11-02T05:00:00Z') });
    expect(bounds.endMs - bounds.startMs).toBe(25 * MS_PER_HOUR);
  });

  it('25-hour day in London (2026-10-25, BST → GMT)', () => {
    const bounds = precisionBounds(
      claim('2026-10-25T09:30:00+01:00', 'day', { claimedAtEnd: '2026-10-26T00:00:00+00:00' }),
    );
    expect(bounds).toEqual({ startMs: at('2026-10-24T23:00:00Z'), endMs: at('2026-10-26T00:00:00Z') });
  });

  it('applies to any precision: 1 ms after claimedAt is the shortest unit allowed', () => {
    const claimedAt = '2026-10-06T14:02:30-04:00';
    const end = '2026-10-06T14:02:30.001-04:00';
    expect(precisionBounds(claim(claimedAt, 'minute', { claimedAtEnd: end }))).toEqual({
      startMs: at('2026-10-06T14:02:00-04:00'),
      endMs: at(end),
    });
  });

  it.each([
    ['equal to claimedAt', '2026-10-06T14:02:30-04:00'],
    ['1 ms before claimedAt', '2026-10-06T14:02:29.999-04:00'],
    ['the same instant in another offset', '2026-10-06T18:02:30Z'],
  ])('rejects an end %s: it must be strictly after (as the Claim schema requires)', (_, claimedAtEnd) => {
    const bad = claim('2026-10-06T14:02:30-04:00', 'minute', { claimedAtEnd });
    expect(() => precisionBounds(bad)).toThrow(WindowError);
    expect(() => precisionBounds(bad)).toThrow(expect.objectContaining({ code: 'end_not_after_claimed_at' }));
  });
});

describe('claimWindow: every non-calendar type', () => {
  it('is [start − beforeClaimMin, end + afterClaimMin] with the policy edges (2 and 45 min)', () => {
    expect(claimWindow(claim('2026-10-06T14:02:00-04:00'), DEFAULT_POLICY)).toEqual({
      fromMs: at('2026-10-06T14:00:00-04:00'),
      toMs: at('2026-10-06T14:48:00-04:00'),
      edgeBeforeMs: 2 * MS_PER_MINUTE,
      edgeAfterMs: 45 * MS_PER_MINUTE,
      anchor: { startMs: at('2026-10-06T14:02:00-04:00'), endMs: at('2026-10-06T14:03:00-04:00') },
    });
  });

  it('follows the policy: a changed window changes the result with no code change', () => {
    const window = claimWindow(
      claim('2026-10-06T14:02:00-04:00'),
      withWindows({ beforeClaimMin: 10, afterClaimMin: 0 }),
    );
    expect(window?.fromMs).toBe(at('2026-10-06T13:52:00-04:00'));
    expect(window?.toMs).toBe(at('2026-10-06T14:03:00-04:00'));
  });

  it.each([
    'email.sent',
    'purchase.made',
    'subscription.changed',
    'listing.posted',
    'message.sent',
    'other',
  ] as const)('%s is anchored on claimedAt and ignores targetAt', (type) => {
    const window = claimWindow(
      { ...claim('2026-10-06T14:02:00-04:00'), type, targetAt: '2026-12-25T09:00:00Z' },
      DEFAULT_POLICY,
    );
    expect(window?.anchor.startMs).toBe(at('2026-10-06T14:02:00-04:00'));
  });
});

describe('claimWindow: midnight crossings', () => {
  it('claim 23:58, observation 00:01 the next day lies inside the window (mandatory timezone edge)', () => {
    const window = claimWindow(claim('2026-10-06T23:58:00-04:00'), DEFAULT_POLICY);
    expect(window?.fromMs).toBe(at('2026-10-06T23:56:00-04:00'));
    expect(window?.toMs).toBe(at('2026-10-07T00:44:00-04:00'));
    const observed = at('2026-10-07T00:01:00-04:00');
    expect(window !== null && window.fromMs <= observed && observed <= window.toMs).toBe(true);
  });

  it('a day-precision claim reaches back across the previous midnight by beforeClaimMin', () => {
    const window = claimWindow(claim('2026-10-05T12:00:00-04:00', 'day'), DEFAULT_POLICY);
    expect(window?.fromMs).toBe(at('2026-10-04T23:58:00-04:00'));
    expect(window?.toMs).toBe(at('2026-10-06T00:45:00-04:00'));
  });

  it('25-hour day: 23:50 local is inside only because claimedAtEnd is the true next midnight', () => {
    const observed = at('2026-11-01T23:50:00-05:00');
    const day = claim('2026-11-01T00:00:00-04:00', 'day');
    const naive = claimWindow(day, DEFAULT_POLICY);
    const safe = claimWindow({ ...day, claimedAtEnd: '2026-11-02T00:00:00-05:00' }, DEFAULT_POLICY);
    expect(naive?.toMs).toBe(at('2026-11-01T23:45:00-05:00'));
    expect(safe?.toMs).toBe(at('2026-11-02T00:45:00-05:00'));
    expect(naive !== null && observed <= naive.toMs).toBe(false);
    expect(safe !== null && observed <= safe.toMs).toBe(true);
  });

  it('23-hour day: the window ends at the true next midnight + afterClaimMin', () => {
    const window = claimWindow(
      claim('2026-03-08T00:00:00-05:00', 'day', { claimedAtEnd: '2026-03-09T00:00:00-04:00' }),
      DEFAULT_POLICY,
    );
    expect(window?.fromMs).toBe(at('2026-03-07T23:58:00-05:00'));
    expect(window?.toMs).toBe(at('2026-03-09T00:45:00-04:00'));
  });
});

const CALENDAR_TYPES: readonly ActionType[] = ['calendar.created', 'calendar.updated', 'calendar.deleted'];

describe('claimWindow: calendar types are centred on targetAt', () => {
  it.each(CALENDAR_TYPES)(
    '%s: [targetAt − 3 days, targetAt + 3 days], anchor [targetAt, targetAt]',
    (type) => {
      const target = at('2026-10-08T14:00:00-04:00');
      const window = claimWindow(
        { ...claim('2026-10-06T14:02:00-04:00'), type, targetAt: '2026-10-08T14:00:00-04:00' },
        DEFAULT_POLICY,
      );
      expect(window).toEqual({
        fromMs: at('2026-10-05T14:00:00-04:00'),
        toMs: at('2026-10-11T14:00:00-04:00'),
        edgeBeforeMs: 3 * MS_PER_DAY,
        edgeAfterMs: 3 * MS_PER_DAY,
        anchor: { startMs: target, endMs: target },
      });
    },
  );

  it.each(CALENDAR_TYPES)('%s without targetAt has no window (rule no_target)', (type) => {
    expect(claimWindow({ ...claim('2026-10-06T14:02:00-04:00'), type }, DEFAULT_POLICY)).toBeNull();
  });

  it('ignores claimedAt, its precision and claimedAtEnd', () => {
    const base = { type: 'calendar.updated' as const, targetAt: '2026-10-08T14:00:00-04:00' };
    const a = claimWindow(
      { ...base, claimedAt: '2026-01-01T00:00:00Z', claimedAtPrecision: 'day' },
      DEFAULT_POLICY,
    );
    const b = claimWindow(
      {
        ...base,
        claimedAt: '2026-10-06T14:02:00-04:00',
        claimedAtPrecision: 'minute',
        claimedAtEnd: '2026-10-07T00:00:00Z',
      },
      DEFAULT_POLICY,
    );
    expect(a).toEqual(b);
  });
});

describe('claimWindow: calendar edges follow instants and policy', () => {
  it('counts days as 24 h of instants across a DST change (the window never shrinks to a local-day count)', () => {
    const window = claimWindow(
      {
        ...claim('2026-10-30T10:00:00-04:00'),
        type: 'calendar.created',
        targetAt: '2026-11-02T10:00:00-05:00',
      },
      DEFAULT_POLICY,
    );
    expect(window?.fromMs).toBe(at('2026-11-02T10:00:00-05:00') - 3 * MS_PER_DAY);
    expect(window?.fromMs).toBe(at('2026-10-30T11:00:00-04:00'));
  });

  it('follows policy.windows.calendarDays', () => {
    const window = claimWindow(
      { ...claim('2026-10-06T14:02:00-04:00'), type: 'calendar.deleted', targetAt: '2026-10-08T14:00:00Z' },
      withWindows({ calendarDays: 0 }),
    );
    expect(window).toMatchObject({ fromMs: at('2026-10-08T14:00:00Z'), toMs: at('2026-10-08T14:00:00Z') });
  });

  it('throws WindowError(unsafe_window) instead of rounding a bound past 2^53 ms', () => {
    const huge = withWindows({ calendarDays: Math.floor(Number.MAX_SAFE_INTEGER / MS_PER_DAY) });
    const far = {
      ...claim('2026-10-06T14:02:00-04:00'),
      type: 'calendar.created' as const,
      targetAt: '2026-10-08T14:00:00Z',
    };
    expect(() => claimWindow(far, huge)).toThrow(expect.objectContaining({ code: 'unsafe_window' }));
  });
});

describe('isCalendarType', () => {
  it('is true exactly for the calendar.* types', () => {
    const all: readonly ActionType[] = [
      ...CALENDAR_TYPES,
      'email.sent',
      'purchase.made',
      'subscription.changed',
      'listing.posted',
      'message.sent',
      'other',
    ];
    expect(all.filter(isCalendarType)).toEqual(CALENDAR_TYPES);
  });
});

describe('a schema-parsed Claim is a WindowClaim', () => {
  it('a 25-hour day claim from the Claim schema yields the true-midnight window', () => {
    const parsed: Claim = Claim.parse({
      id: idFromHash(sha256Hex('window-claim')),
      agent: 'muse',
      type: 'email.sent',
      counterparty: 'priya@company.com',
      claimedAt: '2026-11-01T00:00:00-04:00',
      claimedAtPrecision: 'day',
      claimedAtEnd: '2026-11-02T00:00:00-05:00',
      observedAt: '2026-11-02T09:00:00-05:00',
      sourceKind: 'activity_view',
      extractor: { id: 'golden', version: '1', confidence: 1 },
      rawHash: sha256Hex('window-claim-raw'),
    });
    expect(claimWindow(parsed, DEFAULT_POLICY)).toMatchObject({
      fromMs: at('2026-10-31T23:58:00-04:00'),
      toMs: at('2026-11-02T00:45:00-05:00'),
    });
  });
});
