/**
 * Task 1.4: exact rationals (docs/grading.md §5.3). Every grade-relevant number is a reduced BigInt rational;
 * threshold and tie comparisons cross-multiply; display numbers are rounded to 4 decimals and never compared.
 */
import { describe, expect, it } from 'vitest';

import {
  compareRatio,
  ratio,
  RATIO_ONE,
  RATIO_ZERO,
  type Ratio,
  RatioError,
  type RatioErrorCode,
  ratioGteBasisPoints,
  toDisplay,
  weightedScore,
} from '../../../src/core/ratio';

const r = (num: number, den: number): Ratio => ratio(num, den);
const text = (value: Ratio): string => `${value.num}/${value.den}`;

function errorCode(run: () => unknown): RatioErrorCode | 'no error' {
  try {
    run();
  } catch (error) {
    if (error instanceof RatioError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('ratio()', () => {
  it.each([
    [6, 8, '3/4'],
    [0, 5, '0/1'],
    [5, 5, '1/1'],
    [3, -6, '-1/2'],
    [-3, -6, '1/2'],
    [-0, 7, '0/1'],
    [2_640_000, 2_700_000, '44/45'],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '1/1'],
  ])('ratio(%d, %d) is %s, reduced with a positive denominator', (num, den, expected) => {
    expect(text(ratio(num, den))).toBe(expected);
  });

  it('accepts BigInt parts beyond 2^53 and reduces them exactly', () => {
    const big = 2n ** 80n;
    expect(text(ratio(big * 3n, big * 9n))).toBe('1/3');
    expect(ratio(big + 1n, 1n).num).toBe(big + 1n);
  });

  it.each([
    ['a zero denominator', () => ratio(1, 0), 'invalid_denominator'],
    ['a zero BigInt denominator', () => ratio(1n, 0n), 'invalid_denominator'],
    ['a fractional numerator', () => ratio(0.5, 1), 'not_an_integer'],
    ['a fractional denominator', () => ratio(1, 2.5), 'not_an_integer'],
    ['NaN', () => ratio(Number.NaN, 1), 'not_an_integer'],
    ['Infinity', () => ratio(1, Number.POSITIVE_INFINITY), 'not_an_integer'],
    ['an unsafe integer (2^53)', () => ratio(Number.MAX_SAFE_INTEGER + 1, 1), 'not_an_integer'],
  ] as const)('rejects %s with a typed error', (_label, run, code) => {
    expect(errorCode(run)).toBe(code);
  });

  it('returns frozen values, and the shared constants are 0/1 and 1/1', () => {
    expect(Object.isFrozen(ratio(1, 2))).toBe(true);
    expect(text(RATIO_ZERO)).toBe('0/1');
    expect(text(RATIO_ONE)).toBe('1/1');
    expect(Object.isFrozen(RATIO_ZERO) && Object.isFrozen(RATIO_ONE)).toBe(true);
  });

  it('names its errors', () => {
    const error = new RatioError('zero_weight_sum');
    expect(error.name).toBe('RatioError');
    expect(error.message).toContain('zero_weight_sum');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('compareRatio()', () => {
  it.each([
    [r(1, 3), r(2, 6), 0],
    [r(1, 3), r(1, 2), -1],
    [r(2, 3), r(1, 2), 1],
    [r(-1, 2), r(0, 1), -1],
    [r(17, 20), r(8500, 10_000), 0],
    [r(8_078_399, 9_504_000), r(17, 20), -1],
    [r(9_503_999, 9_504_000), RATIO_ONE, -1],
  ] as const)('compares %o with %o as %d', (a, b, expected) => {
    expect(compareRatio(a, b)).toBe(expected);
    expect(compareRatio(b, a)).toBe(-expected || 0);
  });

  it('compares hand-built, unreduced values by cross-multiplication', () => {
    expect(compareRatio({ num: 2n, den: 4n }, { num: 1n, den: 2n })).toBe(0);
  });

  it('rejects a hand-built value whose denominator is not positive', () => {
    expect(errorCode(() => compareRatio({ num: 1n, den: 0n }, RATIO_ONE))).toBe('invalid_denominator');
    expect(errorCode(() => compareRatio(RATIO_ONE, { num: 1n, den: -2n }))).toBe('invalid_denominator');
  });
});

describe('ratioGteBasisPoints()', () => {
  it.each([
    [r(17, 20), 8500, true],
    [r(8_078_399, 9_504_000), 8500, false],
    [r(1, 2), 5000, true],
    [r(4999, 10_000), 5000, false],
    [r(35, 72), 5000, false],
    [r(1, 1), 10_000, true],
    [r(0, 1), 0, true],
    [r(1, 3), 3333, true],
    [r(1, 3), 3334, false],
  ] as const)('%o ≥ %d bp is %s', (value, bp, expected) => {
    expect(ratioGteBasisPoints(value, bp)).toBe(expected);
  });

  it('rejects a basis-point value that is negative or not an integer', () => {
    expect(errorCode(() => ratioGteBasisPoints(RATIO_ONE, -1))).toBe('invalid_weight');
    expect(errorCode(() => ratioGteBasisPoints(RATIO_ONE, 8500.5))).toBe('invalid_weight');
    expect(errorCode(() => ratioGteBasisPoints({ num: 1n, den: 0n }, 1))).toBe('invalid_denominator');
  });
});

describe('weightedScore()', () => {
  it('golden 02: (2500·1 + 3500·0 + 1500·1 + 1500·1/3) / 9000 is exactly 1/2', () => {
    const score = weightedScore([
      { weightBp: 2500, value: RATIO_ONE },
      { weightBp: 3500, value: RATIO_ZERO },
      { weightBp: 1500, value: RATIO_ONE },
      { weightBp: 1500, value: r(1, 3) },
    ]);
    expect(text(score)).toBe('1/2');
    expect(ratioGteBasisPoints(score, 5000)).toBe(true);
  });

  it('golden 12: timeProximity 43/44 with three exact features gives 787/792', () => {
    const score = weightedScore([
      { weightBp: 2500, value: r(43, 44) },
      { weightBp: 3500, value: RATIO_ONE },
      { weightBp: 1500, value: RATIO_ONE },
      { weightBp: 1500, value: RATIO_ONE },
    ]);
    expect(text(score)).toBe('787/792');
  });

  it('golden 29: a score of exactly 17/20 meets 8500 bp, where a float sum may not', () => {
    const terms = [
      { weightBp: 2500, value: r(23, 50) },
      { weightBp: 3500, value: RATIO_ONE },
      { weightBp: 1500, value: RATIO_ONE },
      { weightBp: 1500, value: RATIO_ONE },
    ];
    expect(text(weightedScore(terms))).toBe('17/20');
    expect(text(weightedScore([...terms].reverse()))).toBe('17/20');
    expect(ratioGteBasisPoints(weightedScore(terms), 8500)).toBe(true);
  });
});

describe('weightedScore() edge cases', () => {
  it('a zero-weight term contributes nothing and does not count in the denominator', () => {
    const score = weightedScore([
      { weightBp: 0, value: RATIO_ZERO },
      { weightBp: 2000, value: r(1, 2) },
    ]);
    expect(text(score)).toBe('1/2');
  });

  it('accepts hand-built, unreduced values and returns a reduced result', () => {
    expect(text(weightedScore([{ weightBp: 3, value: { num: 2n, den: 4n } }]))).toBe('1/2');
  });

  it.each([
    ['no terms', [], 'zero_weight_sum'],
    ['only zero weights', [{ weightBp: 0, value: RATIO_ONE }], 'zero_weight_sum'],
    ['a negative weight', [{ weightBp: -1, value: RATIO_ONE }], 'invalid_weight'],
    ['a fractional weight', [{ weightBp: 0.5, value: RATIO_ONE }], 'invalid_weight'],
    ['a NaN weight', [{ weightBp: Number.NaN, value: RATIO_ONE }], 'invalid_weight'],
    [
      'a value with a zero denominator',
      [{ weightBp: 1, value: { num: 1n, den: 0n } }],
      'invalid_denominator',
    ],
  ] as const)('rejects %s with a typed error', (_label, terms, code) => {
    expect(errorCode(() => weightedScore(terms))).toBe(code);
  });
});

describe('toDisplay()', () => {
  it.each([
    [r(17, 20), 0.85],
    [r(787, 792), 0.9937],
    [r(1, 3), 0.3333],
    [r(2, 3), 0.6667],
    [r(1, 20_000), 0.0001],
    [r(1, 20_001), 0],
    [r(9_503_999, 9_504_000), 1],
    [r(27_357, 34_552), 0.7918],
    [r(-1, 3), -0.3333],
    [RATIO_ONE, 1],
    [RATIO_ZERO, 0],
  ] as const)('%o displays as %d', (value, expected) => {
    expect(toDisplay(value)).toBe(expected);
  });

  it('never returns -0', () => {
    expect(Object.is(toDisplay(r(-1, 30_000)), 0)).toBe(true);
  });

  it('rejects a hand-built value whose denominator is not positive', () => {
    expect(errorCode(() => toDisplay({ num: 1n, den: 0n }))).toBe('invalid_denominator');
  });
});
