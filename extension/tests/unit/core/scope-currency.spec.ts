/**
 * TECH-C3 (docs/grading.md §6.1, §6.3; Hard Rule 5): one meaning of "counted in spendCurrency". A claim amount
 * with no currency is counted in the grant's `spendCurrency`, for the §6.1 Amount, the `cumulativeAboveCeiling`
 * guard and the priors `priorSpendCents` sums, so leaving the currency out never lets spend escape the cumulative
 * ceiling. With no `spendCurrency`, a missing currency still matches only a missing one.
 */
import { describe, expect, it } from 'vitest';

import { countedInSpendCurrency, spendCurrencyOf } from '../../../src/core/conditions';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { priorSpendCents, type SpendClaim, spendIndex } from '../../../src/core/scope';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;

const spend = (id: string, hhmm: string, currency?: string): SpendClaim => ({
  id: `C${id.padStart(25, '0')}`,
  agent: 'muse',
  type: 'purchase.made',
  amountCents: 3_000,
  ...(currency === undefined ? {} : { currency }),
  claimedAt: at(hhmm),
});

const BARE = spend('1', '09:00');
const USD = spend('2', '09:10', 'USD');
const EUR = spend('3', '09:20', 'EUR');
const HISTORY = [BARE, USD, EUR];

/** priorSpendCents and the batch's spendIndex, which must agree. */
function both(claim: SpendClaim, spendCurrency?: string): [number, number] {
  return [
    priorSpendCents(claim, HISTORY, DEFAULT_POLICY, spendCurrency),
    spendIndex(HISTORY, DEFAULT_POLICY)(claim, spendCurrency),
  ];
}

describe('the counted currency of a claim amount', () => {
  it('is its own currency, or spendCurrency when it has none', () => {
    expect(spendCurrencyOf('EUR', 'USD')).toBe('EUR');
    expect(spendCurrencyOf(undefined, 'USD')).toBe('USD');
    expect(spendCurrencyOf(undefined, undefined)).toBeUndefined();
    expect([countedInSpendCurrency(undefined, 'USD'), countedInSpendCurrency('USD', 'USD')]).toEqual([
      true,
      true,
    ]);
    expect(countedInSpendCurrency('EUR', 'USD')).toBe(false);
  });
});

describe('priorSpendCents under a spendCurrency (§6.3)', () => {
  it('a claim with no currency counts the priors in spendCurrency and those with none', () => {
    expect(both(spend('9', '10:00'), 'USD')).toEqual([6_000, 6_000]);
  });

  it('a claim in spendCurrency counts the priors with no currency too', () => {
    expect(both(spend('9', '10:00', 'USD'), 'USD')).toEqual([6_000, 6_000]);
  });

  it('a claim in another currency counts only that currency: a missing one reads as spendCurrency', () => {
    expect(both(spend('9', '10:00', 'EUR'), 'USD')).toEqual([3_000, 3_000]);
  });

  it('with no spendCurrency, a missing currency matches only a missing one (no ceiling to read it as)', () => {
    expect(both(spend('9', '10:00'))).toEqual([3_000, 3_000]);
    expect(both(spend('9', '10:00', 'USD'))).toEqual([3_000, 3_000]);
  });
});
