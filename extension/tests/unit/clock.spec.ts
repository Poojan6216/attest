/**
 * src/clock.ts: edge timestamps carry the writer's local offset (TECH-7), parse back to the same instant,
 * and order by instant whatever offset they were written with.
 */
import { describe, expect, it } from 'vitest';

import { isoWithLocalOffset, nowIso } from '../../src/clock';
import { dateKey, epochMs } from '../../src/ledger/index-fields';
import { IsoTs } from '../../src/ledger/types';

const OFFSET = /[+-]\d{2}:\d{2}$/;

describe('isoWithLocalOffset', () => {
  it.each([0, 1_759_276_800_000, 1_759_363_199_999, 1_700_000_000_123])(
    'round-trips the instant %i',
    (ms) => {
      const date = new Date(ms);
      const iso = isoWithLocalOffset(date);
      expect(iso).toMatch(OFFSET);
      expect(IsoTs.safeParse(iso).success).toBe(true);
      expect(Date.parse(iso)).toBe(ms);
      const offset = -date.getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      expect(
        iso.endsWith(
          `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`,
        ),
      ).toBe(true);
    },
  );

  it('nowIso is a valid IsoTs with an offset', () => {
    const iso = nowIso();
    expect(IsoTs.safeParse(iso).success).toBe(true);
    expect(iso).toMatch(OFFSET);
  });
});

describe('one instant, two offsets', () => {
  const asZ = '2026-10-02T03:30:00.000Z';
  const asMinus5 = '2026-10-01T22:30:00.000-05:00';
  const later = '2026-10-01T23:00:00.000-05:00';

  it('orders identically by epoch ms, never by string', () => {
    expect(epochMs(asZ)).toBe(epochMs(asMinus5));
    expect([later, asZ].sort((a, b) => epochMs(a) - epochMs(b))).toEqual([asZ, later]);
    expect([later, asMinus5].sort((a, b) => epochMs(a) - epochMs(b))).toEqual([asMinus5, later]);
  });

  it("keeps each writer's local date in dateKey", () => {
    expect(dateKey(asZ)).toBe('2026-10-02');
    expect(dateKey(asMinus5)).toBe('2026-10-01');
  });
});
