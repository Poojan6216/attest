/**
 * ScopeError codes (docs/grading.md §6.3; scope.ts `ScopeErrorCode`; QA Sprint 1 review). scope.spec.ts proves that
 * bad spend input throws a ScopeError, but not which one: a mutant that swaps `invalid_amount` for `unsafe_window`,
 * or deletes the `unsafe_window` check, survived the whole suite. Each code is pinned here, for `priorSpendCents`
 * and for the batch's `spendIndex` (which must refuse exactly what `priorSpendCents` refuses: fail loud, Hard Rule 6,
 * never a rounded or lowered total).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { priorSpendCents, ScopeError, type SpendClaim, spendIndex } from '../../../src/core/scope';
import { MS_PER_DAY } from '../../../src/core/units';
import { mergePatch } from '../../golden/build';

/** The longest spend window the loader accepts: `spendWindowDays × MS_PER_DAY` is still a safe integer. */
const LONGEST_WINDOW_DAYS = Math.floor(Number.MAX_SAFE_INTEGER / MS_PER_DAY);
const LONG_WINDOW = loadPolicy(
  mergePatch(defaultPolicyJson, { windows: { spendWindowDays: LONGEST_WINDOW_DAYS } }),
);

let nextId = 0;
function spend(fields: Partial<SpendClaim> & Pick<SpendClaim, 'claimedAt'>): SpendClaim {
  nextId += 1;
  return {
    id: `E${String(nextId).padStart(25, '0')}`,
    agent: 'muse',
    type: 'purchase.made',
    amountCents: 3_000,
    currency: 'USD',
    ...fields,
  };
}

describe('ScopeError invalid_amount: a prior amount that cannot be summed exactly', () => {
  it.each([
    ['a negative amount', -1],
    ['a fractional amount', 1.5],
    ['NaN', Number.NaN],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 2],
  ])('%s throws invalid_amount from priorSpendCents and from spendIndex', (_label, amountCents) => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const bad = spend({ claimedAt: '2026-10-06T09:00:00-04:00', amountCents });
    const expected = new ScopeError('invalid_amount');
    expect(() => priorSpendCents(claim, [bad], DEFAULT_POLICY)).toThrow(expected);
    expect(() => spendIndex([bad, claim], DEFAULT_POLICY)(claim)).toThrow(expected);
  });

  it('a bad amount outside the window or of another agent is not read', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const old = spend({ claimedAt: '2026-08-01T10:00:00-04:00', amountCents: -1 });
    const other = spend({ claimedAt: '2026-10-06T09:00:00-04:00', agent: 'claude', amountCents: -1 });
    expect(priorSpendCents(claim, [old, other], DEFAULT_POLICY)).toBe(0);
    expect(spendIndex([old, other, claim], DEFAULT_POLICY)(claim)).toBe(0);
  });
});

describe('ScopeError unsafe_window: a window start outside the safe-integer range', () => {
  it('the loader accepts the longest window, and a claim in year 0001 then has an unsafe window start', () => {
    expect(LONG_WINDOW.windows.spendWindowDays).toBe(LONGEST_WINDOW_DAYS);
    const claim = spend({ claimedAt: '0001-01-02T00:00:00Z' });
    const prior = spend({ claimedAt: '0001-01-01T00:00:00Z' });
    const expected = new ScopeError('unsafe_window');
    expect(() => priorSpendCents(claim, [prior, claim], LONG_WINDOW)).toThrow(expected);
    expect(() => spendIndex([prior, claim], LONG_WINDOW)(claim)).toThrow(expected);
  });

  it('the same window from a recent claim is safe and counts every earlier purchase', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const ancient = spend({ claimedAt: '1900-01-01T00:00:00Z' });
    expect(priorSpendCents(claim, [ancient, claim], LONG_WINDOW)).toBe(3_000);
    expect(spendIndex([ancient, claim], LONG_WINDOW)(claim)).toBe(3_000);
  });

  it('a type outside spendTypes reads no window at all (0, never a throw)', () => {
    const claim = spend({ claimedAt: '0001-01-02T00:00:00Z', type: 'email.sent' });
    expect(priorSpendCents(claim, [claim], LONG_WINDOW)).toBe(0);
    expect(spendIndex([claim], LONG_WINDOW)(claim)).toBe(0);
  });
});
