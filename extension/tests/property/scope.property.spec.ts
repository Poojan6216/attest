/**
 * Cumulative spend (docs/grading.md §6.3): `spendIndex(history, policy)` is the batch's fast path for
 * `priorSpendCents(claim, history, policy)` (sorted runs with running sums, a fallback for irregular runs). These
 * properties pin the two together, under any grant `spendCurrency` (or none), over histories that mix agents,
 * currencies (and none), spend and non-spend
 * types, offsets, ties at one instant, window edges, and claim ids listed more than once, with the copies of an
 * id anywhere in (claimedAt, id) order, as when a batch passes its claims together with the ledger's (§3).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../src/core/policy';
import { priorSpendCents, type SpendClaim, spendIndex } from '../../src/core/scope';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../src/core/units';

const RUNS = { numRuns: 1_000 };
const START_MS = Date.parse('2026-09-01T00:00:00Z');
const SPAN_DAYS = DEFAULT_POLICY.windows.spendWindowDays * 2;
const OFFSETS = [0, -240, 330, 345] as const;

/** `ms` written at `offsetMinutes` with an explicit ±hh:mm offset (a `Z` for 0 half the time). */
function isoAt(ms: number, offsetMinutes: number, zulu: boolean): string {
  const local = new Date(ms + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 23);
  if (offsetMinutes === 0 && zulu) return `${local}Z`;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${local}${sign}${two(Math.floor(magnitude / 60))}:${two(magnitude % 60)}`;
}

const spendClaim: fc.Arbitrary<SpendClaim> = fc
  .record({
    idIndex: fc.integer({ min: 0, max: 7 }),
    agent: fc.constantFrom('muse', 'chatgpt'),
    type: fc.constantFrom('purchase.made', 'subscription.changed', 'email.sent'),
    amountCents: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
    currency: fc.option(fc.constantFrom('USD', 'EUR'), { nil: undefined }),
    // Whole minutes, so equal instants (and the id tie-break) are common.
    minute: fc.integer({ min: 0, max: SPAN_DAYS * (MS_PER_DAY / MS_PER_MINUTE) }),
    milliseconds: fc.constantFrom(0, 0, 0, 1, 999),
    offset: fc.constantFrom(...OFFSETS),
    zulu: fc.boolean(),
  })
  .map(({ idIndex, minute, milliseconds, offset, zulu, ...rest }) => ({
    id: `C${String(idIndex).padStart(25, '0')}`,
    claimedAt: isoAt(START_MS + minute * MS_PER_MINUTE + milliseconds, offset, zulu),
    ...rest,
  }));

/** A history whose ids repeat (8 ids for up to 40 claims), copies anywhere in it; full-length lists are generated. */
const history = fc.array(spendClaim, { minLength: 0, maxLength: 40, size: 'max' });

/** The grant's `spendCurrency`, which a missing claim currency reads as (§6.3), or none. */
const spendCurrency = fc.option(fc.constantFrom('USD', 'EUR'), { nil: undefined });

describe('spendIndex is priorSpendCents (§6.3)', () => {
  it('for every claim of the history, against the whole history, under any spendCurrency', () => {
    fc.assert(
      fc.property(history, spendCurrency, (claims, spend) => {
        const prior = spendIndex(claims, DEFAULT_POLICY);
        for (const claim of claims) {
          expect(prior(claim, spend)).toBe(priorSpendCents(claim, claims, DEFAULT_POLICY, spend));
        }
      }),
      RUNS,
    );
  });

  it('for claims outside the history (a batch claim the ledger does not hold yet)', () => {
    fc.assert(
      fc.property(
        history,
        fc.array(spendClaim, { minLength: 1, maxLength: 8 }),
        spendCurrency,
        (claims, graded, spend) => {
          const prior = spendIndex(claims, DEFAULT_POLICY);
          for (const claim of graded) {
            expect(prior(claim, spend)).toBe(priorSpendCents(claim, claims, DEFAULT_POLICY, spend));
          }
        },
      ),
      RUNS,
    );
  });

  it('one id read twice, with another claim between the two reads, counts once (at its larger amount)', () => {
    const base = { agent: 'muse', type: 'purchase.made', currency: 'USD' } as const;
    const first: SpendClaim = { ...base, id: 'X', claimedAt: '2026-10-06T14:02:10Z', amountCents: 100 };
    const between: SpendClaim = { ...base, id: 'Y', claimedAt: '2026-10-06T14:02:30Z', amountCents: 200 };
    const again: SpendClaim = { ...base, id: 'X', claimedAt: '2026-10-06T14:02:50Z', amountCents: 300 };
    const graded: SpendClaim = { ...base, id: 'Z', claimedAt: '2026-10-06T14:30:00Z', amountCents: 50 };
    for (const claims of [
      [first, between, again, graded],
      [again, graded, between, first],
    ]) {
      expect(priorSpendCents(graded, claims, DEFAULT_POLICY)).toBe(500);
      expect(spendIndex(claims, DEFAULT_POLICY)(graded)).toBe(500);
    }
  });
});
