/**
 * Property tests for assign() (docs/grading.md §4.3), 1,000 runs each:
 *  - one-to-one both ways, fixed pairs kept, taken observations never assigned, only pairs ≥ partial used;
 *  - maximal: no eligible pair is left with both its claim and its observation free;
 *  - independent of the input order of pairs and fixed pairs (identical entries, identical order);
 *  - equal to an independent greedy oracle (scores compared by BigInt cross-multiplication here).
 * Scores include unreduced fractions, and claimedAt and scores collide often, so every tie-break is hit.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assign, type FixedPair, type ScoredPair } from '../../src/core/candidates';
import { DEFAULT_POLICY } from '../../src/core/policy';
import type { Ratio } from '../../src/core/ratio';
import { Ulid } from '../../src/core/schema';

const RUNS = 1_000;
const PARTIAL_BP = BigInt(DEFAULT_POLICY.bp.thresholds.partial);
const T0 = Date.parse('2026-10-06T14:02:00-04:00');

const id = (n: number): Ulid => Ulid.parse(String(n).padStart(26, '0'));
const claimId = (n: number) => id(100 + n);
const observationId = (n: number) => id(200 + n);

const CLAIMS = 6;
const OBSERVATIONS = 6;

/** A score n/d in [0, 1], written as (n·m)/(d·m) so equal values arrive in different representations. */
const scoreArb = fc
  .record({ d: fc.integer({ min: 1, max: 6 }), n: fc.nat({ max: 6 }), m: fc.integer({ min: 1, max: 3 }) })
  .map(({ d, n, m }): Ratio => ({ num: BigInt(Math.min(n, d) * m), den: BigInt(d * m) }));

const pairsArb = fc
  .record({
    claimTimes: fc.array(fc.constantFrom(T0, T0 + 1, T0 + 60_000), { minLength: CLAIMS, maxLength: CLAIMS }),
    raw: fc.array(
      fc.record({ c: fc.nat({ max: CLAIMS - 1 }), o: fc.nat({ max: OBSERVATIONS - 1 }), score: scoreArb }),
      { maxLength: 24 },
    ),
  })
  .map(({ claimTimes, raw }): ScoredPair[] =>
    raw.map(({ c, o, score }) => ({
      claimId: claimId(c),
      claimedAtMs: claimTimes[c] ?? T0,
      observationId: observationId(o),
      score,
    })),
  );

/** A one-to-one partial matching, over a wider id range so some fixed claims and observations are unscored. */
const fixedArb = fc
  .record({
    observations: fc.uniqueArray(fc.nat({ max: OBSERVATIONS + 1 }), { maxLength: 3 }),
    claims: fc.uniqueArray(fc.nat({ max: CLAIMS + 1 }), { maxLength: 3 }),
  })
  .map(({ observations, claims }): FixedPair[] =>
    observations.flatMap((o, i) => {
      const c = claims[i];
      return c === undefined ? [] : [{ observationId: observationId(o), claimId: claimId(c) }];
    }),
  );

const takenArb = fc
  .uniqueArray(fc.nat({ max: OBSERVATIONS - 1 }), { maxLength: 2 })
  .map((list) => new Set(list.map(observationId)));

const atLeastPartial = (score: Ratio) => score.num * 10_000n >= PARTIAL_BP * score.den;

/** Negative when `a` should be taken before `b` (§4.3), compared without ratio.ts. */
function oracleOrder(a: ScoredPair, b: ScoredPair): number {
  const left = a.score.num * b.score.den;
  const right = b.score.num * a.score.den;
  if (left !== right) return left > right ? -1 : 1;
  if (a.claimedAtMs !== b.claimedAtMs) return a.claimedAtMs - b.claimedAtMs;
  if (a.claimId !== b.claimId) return a.claimId < b.claimId ? -1 : 1;
  if (a.observationId !== b.observationId) return a.observationId < b.observationId ? -1 : 1;
  return 0;
}

/** The greedy written plainly: repeatedly take the best remaining eligible pair whose ends are both free. */
function oracle(pairs: readonly ScoredPair[], fixed: readonly FixedPair[], taken: ReadonlySet<Ulid>) {
  const result = new Map(fixed.map((f) => [f.observationId, f.claimId] as const));
  const claims = new Set(fixed.map((f) => f.claimId));
  let remaining = pairs.filter((p) => atLeastPartial(p.score));
  for (;;) {
    const free = remaining.filter(
      (p) => !result.has(p.observationId) && !taken.has(p.observationId) && !claims.has(p.claimId),
    );
    const best = free.reduce<ScoredPair | undefined>(
      (x, p) => (x === undefined || oracleOrder(p, x) < 0 ? p : x),
      undefined,
    );
    if (best === undefined) break;
    result.set(best.observationId, best.claimId);
    claims.add(best.claimId);
    remaining = remaining.filter((p) => p !== best);
  }
  return [...result].sort(([a], [b]) => (a < b ? -1 : 1));
}

function permute<T>(items: readonly T[], keys: readonly number[]): T[] {
  return items
    .map((item, i) => ({ item, key: keys[i % Math.max(keys.length, 1)] ?? 0, i }))
    .sort((x, y) => x.key - y.key || y.i - x.i)
    .map(({ item }) => item);
}

describe('assign (property)', () => {
  it('is one-to-one, keeps fixed pairs, uses only pairs ≥ partial, avoids taken, and is maximal', () => {
    fc.assert(
      fc.property(pairsArb, fixedArb, takenArb, (pairs, fixed, taken) => {
        const result = assign(pairs, DEFAULT_POLICY, fixed, taken);
        const claims = [...result.values()];
        expect(new Set(claims).size).toBe(claims.length);
        for (const f of fixed) expect(result.get(f.observationId)).toBe(f.claimId);
        const fixedClaims = new Set(fixed.map((f) => f.claimId));
        for (const [o, c] of result) {
          if (fixed.some((f) => f.observationId === o)) continue;
          expect(taken.has(o) || fixedClaims.has(c)).toBe(false);
          expect(pairs.some((p) => p.observationId === o && p.claimId === c && atLeastPartial(p.score))).toBe(
            true,
          );
        }
        for (const p of pairs.filter((q) => atLeastPartial(q.score) && !taken.has(q.observationId))) {
          expect(result.has(p.observationId) || claims.includes(p.claimId)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('does not depend on the input order of pairs or fixed pairs, and equals the greedy oracle', () => {
    fc.assert(
      fc.property(
        pairsArb,
        fixedArb,
        takenArb,
        fc.array(fc.integer(), { minLength: 1, maxLength: 24 }),
        (pairs, fixed, taken, keys) => {
          const result = [...assign(pairs, DEFAULT_POLICY, fixed, taken)];
          const shuffled = [...assign(permute(pairs, keys), DEFAULT_POLICY, permute(fixed, keys), taken)];
          expect(shuffled).toEqual(result);
          expect([...assign([...pairs].reverse(), DEFAULT_POLICY, [...fixed].reverse(), taken)]).toEqual(
            result,
          );
          expect(result).toEqual(oracle(pairs, fixed, taken));
        },
      ),
      { numRuns: RUNS },
    );
  });
});
