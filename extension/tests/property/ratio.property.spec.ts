/**
 * Task 1.4 properties (fast-check, ≥ 1,000 runs each) for exact rationals (docs/grading.md §5.3): every
 * Ratio is reduced with a positive denominator; comparison is a total order consistent with
 * cross-multiplication; the weighted score is the §5.3 formula, lies in [0, 1] for unit values, and does
 * not depend on term order; display numbers are within half a basis point of the exact value.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  compareFractions,
  compareRatio,
  fractionGteBasisPoints,
  ratio,
  type Ratio,
  ratioGteBasisPoints,
  toDisplay,
  toDisplayOf,
  weightedScore,
  type WeightedTerm,
} from '../../src/core/ratio';
import { BASIS_POINTS } from '../../src/core/units';

const RUNS = { numRuns: 2_000 };

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));

const integer = fc.bigInt({ min: -(2n ** 70n), max: 2n ** 70n });
const nonZero = integer.filter((value) => value !== 0n);
const anyRatio = fc.tuple(integer, nonZero).map(([num, den]) => ratio(num, den));
/** A value in [0, 1], as feature values are. */
const unitRatio = fc
  .tuple(fc.bigInt({ min: 1n, max: 10n ** 9n }), fc.bigInt({ min: 0n, max: 10n ** 9n }))
  .map(([den, k]) => ratio(k % (den + 1n), den));
const term: fc.Arbitrary<WeightedTerm> = fc.record({
  weightBp: fc.integer({ min: 0, max: BASIS_POINTS }),
  value: unitRatio,
});
const terms = fc
  .array(term, { minLength: 1, maxLength: 8 })
  .filter((list) => list.some((item) => item.weightBp > 0));

/** The §5.3 formula, written independently: Σ wᵢ·pᵢ·(Q/qᵢ) / (Σwᵢ · Q) with Q = Π qᵢ. */
function reference(list: readonly WeightedTerm[]): Ratio {
  const product = list.reduce((acc, item) => acc * item.value.den, 1n);
  const numerator = list.reduce(
    (acc, item) => acc + BigInt(item.weightBp) * item.value.num * (product / item.value.den),
    0n,
  );
  const weights = list.reduce((acc, item) => acc + BigInt(item.weightBp), 0n);
  return ratio(numerator, weights * product);
}

describe('ratio() invariants', () => {
  it('is reduced, has a positive denominator, and equals num/den', () => {
    fc.assert(
      fc.property(integer, nonZero, (num, den) => {
        const value = ratio(num, den);
        expect(value.den > 0n).toBe(true);
        expect(gcd(value.num, value.den)).toBe(1n);
        expect(value.num * den).toBe(num * value.den);
      }),
      RUNS,
    );
  });

  it('gives one representation per value: ratio(k·n, k·d) equals ratio(n, d)', () => {
    fc.assert(
      fc.property(integer, nonZero, nonZero, (num, den, k) => {
        expect(ratio(num * k, den * k)).toEqual(ratio(num, den));
      }),
      RUNS,
    );
  });
});

describe('compareRatio() is an exact total order', () => {
  it('is antisymmetric and agrees with cross-multiplication', () => {
    fc.assert(
      fc.property(anyRatio, anyRatio, (a, b) => {
        const expected = a.num * b.den === b.num * a.den ? 0 : a.num * b.den < b.num * a.den ? -1 : 1;
        expect(compareRatio(a, b)).toBe(expected);
        expect(compareRatio(b, a)).toBe(-expected || 0);
        expect(compareRatio(a, a)).toBe(0);
      }),
      RUNS,
    );
  });

  it('is transitive', () => {
    fc.assert(
      fc.property(anyRatio, anyRatio, anyRatio, (a, b, c) => {
        const [low, mid, high] = [a, b, c].sort(compareRatio);
        if (low === undefined || mid === undefined || high === undefined) throw new Error('three values');
        expect(compareRatio(low, high)).toBeLessThanOrEqual(0);
        expect(compareRatio(low, mid)).toBeLessThanOrEqual(0);
        expect(compareRatio(mid, high)).toBeLessThanOrEqual(0);
      }),
      RUNS,
    );
  });

  it('ratioGteBasisPoints(r, bp) is compareRatio(r, bp/10000) ≥ 0', () => {
    fc.assert(
      fc.property(anyRatio, fc.integer({ min: 0, max: BASIS_POINTS }), (value, bp) => {
        expect(ratioGteBasisPoints(value, bp)).toBe(compareRatio(value, ratio(bp, BASIS_POINTS)) >= 0);
      }),
      RUNS,
    );
  });
});

/** Non-negative safe integers: small ones, ones near 2^53, and everything between. */
const count = fc.oneof(
  fc.integer({ min: 0, max: 1_000 }),
  fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  fc.integer({ min: Number.MAX_SAFE_INTEGER - 1_000, max: Number.MAX_SAFE_INTEGER }),
);
const positive = count.map((value) => Math.max(value, 1));

describe('compareFractions() is compareRatio() in Number, exactly (§5.3)', () => {
  it('agrees with BigInt cross-multiplication on any safe operands, near 2^53 included', () => {
    fc.assert(
      fc.property(count, positive, count, positive, (a, b, c, d) => {
        expect(compareFractions(a, b, c, d)).toBe(compareRatio(ratio(a, b), ratio(c, d)));
      }),
      { numRuns: 20_000 },
    );
  });

  it('calls equal values equal however they are written, and orders a value against its neighbours', () => {
    fc.assert(
      fc.property(count, positive, fc.integer({ min: 1, max: 1_000_000 }), (n, d, k) => {
        const [num, den] = [n % (d + 1), d];
        if (num * k > Number.MAX_SAFE_INTEGER || den * k > Number.MAX_SAFE_INTEGER) return;
        expect(compareFractions(num, den, num * k, den * k)).toBe(0);
        if (num + 1 <= Number.MAX_SAFE_INTEGER) expect(compareFractions(num, den, num + 1, den)).toBe(-1);
        if (den + 1 <= Number.MAX_SAFE_INTEGER)
          expect(compareFractions(num, den + 1, num, den)).toBe(num === 0 ? 0 : -1);
      }),
      RUNS,
    );
  });

  it('fractionGteBasisPoints(n, d, bp) is ratioGteBasisPoints(n/d, bp)', () => {
    fc.assert(
      fc.property(count, positive, fc.integer({ min: 0, max: BASIS_POINTS }), (n, d, bp) => {
        expect(fractionGteBasisPoints(n, d, bp)).toBe(ratioGteBasisPoints(ratio(n, d), bp));
      }),
      { numRuns: 10_000 },
    );
  });
});

const sign = (x: bigint): -1 | 0 | 1 => (x === 0n ? 0 : x < 0n ? -1 : 1);
const crossSign = (a: number, b: number, c: number, d: number): -1 | 0 | 1 =>
  sign(BigInt(a) * BigInt(d) - BigInt(c) * BigInt(b));

/** 2^53 + k for k = −1 … 4, each as its prime factors (every one a safe integer). */
const NEAR_2_53: readonly (readonly bigint[])[] = [
  [6_361n, 69_431n, 20_394_401n],
  Array.from({ length: 53 }, () => 2n),
  [3n, 107n, 28_059_810_762_433n],
  [2n, 17n, 858_001n, 308_761_441n],
  [5n, 7n, 11n, 1_187n, 19_709_623_201n],
  [2n, 2n, 3n, 3n, 307n, 2_857n, 6_529n, 43_691n],
];

/** `product` written as x·y with x and y both ≥ 2 (so both are safe integers), the primes `mask` picks in x. */
function split(primes: readonly bigint[], mask: readonly boolean[]): [number, number] {
  const product = primes.reduce((total, prime) => total * prime, 1n);
  const first = primes[0] ?? 1n;
  let x = primes.reduce((total, prime, i) => (mask[i] === true ? total * prime : total), 1n);
  if (x === 1n) x = first;
  if (x === product) x = product / first;
  return [Number(x), Number(product / x)];
}

describe('compareFractions() where the float cross products tie or straddle 2^53 (§5.3)', () => {
  it('(n + j)/(n + i) against (n + j + t)/(n + i + t): cross products t·(j − i) apart, n up to 2^53', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 3, max: Number.MAX_SAFE_INTEGER - 6 }),
          fc.integer({ min: 94_906_200, max: 94_906_300 }),
          fc.integer({ min: Number.MAX_SAFE_INTEGER - 1_000, max: Number.MAX_SAFE_INTEGER - 6 }),
        ),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        (n, i, j, t) => {
          const [a, b, c, d] = [n + j, n + i, n + j + t, n + i + t];
          expect(compareFractions(a, b, c, d)).toBe(crossSign(a, b, c, d));
          expect(compareFractions(c, d, a, b)).toBe(crossSign(c, d, a, b));
        },
      ),
      { numRuns: 10_000 },
    );
  });

  it('cross products 2^53 + k against 2^53 + m (k, m from −1 to 4), each split into factors any way', () => {
    const products = NEAR_2_53.map((primes) => primes.reduce((total, prime) => total * prime, 1n));
    expect(products).toEqual([-1n, 0n, 1n, 2n, 3n, 4n].map((k) => 2n ** 53n + k));
    const mask = fc.array(fc.boolean(), { minLength: 53, maxLength: 53 });
    const near = fc.constantFrom(...NEAR_2_53);
    fc.assert(
      fc.property(near, mask, near, mask, (left, leftMask, right, rightMask) => {
        const [a, d] = split(left, leftMask);
        const [c, b] = split(right, rightMask);
        expect(compareFractions(a, b, c, d)).toBe(crossSign(a, b, c, d));
        expect(compareFractions(c, d, a, b)).toBe(crossSign(c, d, a, b));
      }),
      RUNS,
    );
  });
});

describe('toDisplayOf() is toDisplay() of the same rational, in Number where exact', () => {
  it('equals toDisplay(ratio(n, d)) for any safe operands, small, large and near 2^53', () => {
    fc.assert(
      fc.property(count, positive, (n, d) => {
        expect(toDisplayOf(n, d)).toBe(toDisplay(ratio(n, d)));
        expect(toDisplayOf(n % (d + 1), d)).toBe(toDisplay(ratio(n % (d + 1), d)));
      }),
      { numRuns: 10_000 },
    );
  });
});

describe('weightedScore() is the exact §5.3 mean', () => {
  it('equals the reference formula', () => {
    fc.assert(
      fc.property(terms, (list) => {
        expect(weightedScore(list)).toEqual(reference(list));
      }),
      RUNS,
    );
  });

  it('lies in [0, 1] when every value does', () => {
    fc.assert(
      fc.property(terms, (list) => {
        const score = weightedScore(list);
        expect(compareRatio(score, ratio(0, 1))).toBeGreaterThanOrEqual(0);
        expect(compareRatio(score, ratio(1, 1))).toBeLessThanOrEqual(0);
      }),
      RUNS,
    );
  });

  it('does not depend on term order (any permutation gives the identical Ratio)', () => {
    fc.assert(
      fc.property(
        terms.chain((list) =>
          fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length })),
        ),
        ([list, permuted]) => {
          expect(weightedScore(permuted)).toEqual(weightedScore(list));
        },
      ),
      RUNS,
    );
  });

  it('is unchanged by scaling every weight by the same factor', () => {
    fc.assert(
      fc.property(terms, fc.integer({ min: 1, max: 1_000 }), (list, k) => {
        const scaled = list.map((item) => ({ weightBp: item.weightBp * k, value: item.value }));
        expect(weightedScore(scaled)).toEqual(weightedScore(list));
      }),
      RUNS,
    );
  });
});

describe('toDisplay() is display-only and close to the exact value', () => {
  it('is within half a basis point of num/den, on the 4-decimal grid', () => {
    fc.assert(
      fc.property(unitRatio, (value) => {
        const shown = toDisplay(value);
        const scaled = shown * BASIS_POINTS;
        expect(Math.abs(scaled - Math.round(scaled))).toBeLessThan(1e-6);
        // |shown − num/den| ≤ 1/20000, checked exactly: |round·den − 10000·num| ≤ den/2.
        const rounded = BigInt(Math.round(scaled));
        const gap = rounded * value.den - BigInt(BASIS_POINTS) * value.num;
        expect((gap < 0n ? -gap : gap) * 2n <= value.den).toBe(true);
      }),
      RUNS,
    );
  });

  it('is odd: toDisplay(-r) is -toDisplay(r) (never -0)', () => {
    fc.assert(
      fc.property(anyRatio, (value) => {
        const negated = toDisplay(ratio(-value.num, value.den));
        expect(negated).toBe(toDisplay(value) === 0 ? 0 : -toDisplay(value));
        expect(Object.is(negated, -0)).toBe(false);
      }),
      RUNS,
    );
  });
});
