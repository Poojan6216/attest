/**
 * GG-1 (docs/grading.md §3, §6.3 "The claim itself never counts", §10; Hard Rule 5): a claim never counts its own
 * amount, whatever copy holds its id. One purchase read at 10:00:10 and again at 10:00:50 has one id (the id hashes
 * the minute), so the history can hold an earlier copy of the very claim being graded. `priorSpendCents`, the
 * batch's `spendIndex` and `gradeBatch` all leave every copy of the claim's own id out, so one $30 purchase under a
 * $50 ceiling is never OVER_SCOPE against itself.
 */
import { describe, expect, it } from 'vitest';

import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { priorSpendCents, type SpendClaim, spendIndex } from '../../../src/core/scope';
import { Activity, type Claim } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant } from '../../golden/build';
import { ScenarioClaim } from '../../golden/scenario-schema';

const SELF = 'C0000000000000000000000009';

/** A $30 USD purchase by muse; `id` defaults to the graded claim's own. */
const spend = (claimedAt: string, fields: Partial<SpendClaim> = {}): SpendClaim => ({
  id: SELF,
  agent: 'muse',
  type: 'purchase.made',
  amountCents: 3_000,
  currency: 'USD',
  claimedAt,
  ...fields,
});

const CLAIM = spend('2026-10-06T10:00:50-04:00');

/** priorSpendCents and spendIndex for CLAIM against `history`, under 'USD' and under no spendCurrency. */
function priors(history: readonly SpendClaim[]): number[] {
  const index = spendIndex(history, DEFAULT_POLICY);
  return [undefined, 'USD'].flatMap((currency) => [
    priorSpendCents(CLAIM, history, DEFAULT_POLICY, currency),
    index(CLAIM, currency),
  ]);
}

describe('the claim itself never counts, whatever copy holds its id (§6.3)', () => {
  it('an earlier copy of its id, alone or listed twice, is 0', () => {
    const early = spend('2026-10-06T10:00:10-04:00');
    expect(priors([early])).toEqual([0, 0, 0, 0]);
    expect(priors([early, CLAIM])).toEqual([0, 0, 0, 0]);
    expect(priors([CLAIM, early, early])).toEqual([0, 0, 0, 0]);
  });

  it('a copy with another amount, among other priors: only the others count', () => {
    const copy = spend('2026-10-06T10:00:10-04:00', { amountCents: 9_999 });
    const a = spend('2026-10-06T10:00:00-04:00', { id: 'C000000000000000000000000A', amountCents: 1_000 });
    const b = spend('2026-10-06T09:00:00-04:00', { id: 'C000000000000000000000000B', amountCents: 2_000 });
    expect(priors([copy, a, b])).toEqual([3_000, 3_000, 3_000, 3_000]);
    expect(priors([b, CLAIM, a, copy])).toEqual([3_000, 3_000, 3_000, 3_000]);
  });

  it('a copy before the spend window, or after the claim, takes nothing from the priors in it', () => {
    const outside = spend('2026-08-01T10:00:00-04:00', { amountCents: 500 });
    const later = spend('2026-10-06T10:00:59-04:00', { amountCents: 700 });
    const a = spend('2026-10-06T09:00:00-04:00', { id: 'C000000000000000000000000A', amountCents: 1_000 });
    const b = spend('2026-10-05T09:00:00-04:00', { id: 'C000000000000000000000000B', amountCents: 2_000 });
    expect(priors([outside, a, b])).toEqual([3_000, 3_000, 3_000, 3_000]);
    expect(priors([a, later, b])).toEqual([3_000, 3_000, 3_000, 3_000]);
  });
});

describe('gradeBatch: one $30 purchase under a $50 ceiling, its id read twice (§3, §6.3)', () => {
  const EVAL = '2026-10-06T12:00:00-04:00';
  const grant = buildGrant({ agent: 'muse', spendCeilingCents: 5_000, spendCurrency: 'USD' }, EVAL);
  const read = (claimedAt: string): Claim =>
    buildClaim(
      ScenarioClaim.parse({
        ref: 'c1',
        agent: 'muse',
        type: 'purchase.made',
        counterparty: 'acme',
        amountCents: 3_000,
        currency: 'USD',
        claimedAt,
        observedAt: claimedAt,
      }),
    );
  const early = read('2026-10-06T10:00:10-04:00');
  const late = read('2026-10-06T10:00:50-04:00');

  it('the two reads are one claim: one id', () => {
    expect(early.id).toBe(late.id);
    expect(early.claimedAt).not.toBe(late.claimedAt);
  });

  it.each([
    ['the earlier read', [early]],
    ['both reads', [early, late]],
    ['the graded read', [late]],
    ['nothing', []],
  ])('activity.claims holding %s: prior spend 0, never OVER_SCOPE', async (_, listed) => {
    const activity = Activity.parse({
      sessions: [],
      idle: [],
      entries: [],
      adapterSyncs: [],
      claims: listed,
    });
    const index = createMemoryIndex([], 1);
    const [out] = await gradeBatch([late], index, [grant], DEFAULT_POLICY, buildCoverage([], EVAL), activity);
    expect(out?.inputs.context.priorSpendCents).toBe(0);
    expect([out?.receipt.grade, out?.receipt.ruleId]).toEqual(['UNVERIFIABLE', 'no_coverage']);
  });
});
