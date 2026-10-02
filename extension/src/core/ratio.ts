/**
 * Exact rationals for grading (docs/grading.md §5.3; module contract §13). No grade is ever decided in
 * floating point: feature values are rationals p/q with BigInt parts, the score is the exact weighted mean
 * Σ wᵢ·vᵢ / Σ wᵢ over integer basis-point weights, and every comparison (against a threshold, or between two
 * scores for an assignment tie) cross-multiplies in BigInt. A `Ratio` is always reduced with a positive
 * denominator, so one value has exactly one representation and summation order cannot change a result.
 *
 * `toDisplay` is the only way out to a JS number: it rounds to 4 decimals for receipts and the UI, and its
 * result is never compared (§5.3).
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { BASIS_POINTS } from './units';

/** An exact rational number. Every Ratio this module returns is reduced (gcd 1) and has `den > 0`. */
export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
}

/** One term of a weighted score: an integer basis-point weight (policy.bp.*) and an exact value. */
export interface WeightedTerm {
  readonly weightBp: number;
  readonly value: Ratio;
}

export type RatioErrorCode =
  /** `ratio(n, 0)`, or a hand-built Ratio whose denominator is not positive. */
  | 'invalid_denominator'
  /** A number argument that is not a safe integer (a fraction, NaN, ±Infinity, or beyond 2^53). */
  | 'not_an_integer'
  /** A weight or basis-point value that is negative or not a safe integer. */
  | 'invalid_weight'
  /** `weightedScore` over weights that sum to 0: the mean is undefined (§5.3 rejects such a policy at load). */
  | 'zero_weight_sum';

export class RatioError extends Error {
  constructor(readonly code: RatioErrorCode) {
    super(`ratio: ${code}`);
    this.name = 'RatioError';
  }
}

const ZERO = 0n;
const ONE = 1n;
/** 4 decimal places, one basis point: the precision of display numbers (§5.3) and of policy weights. */
const BASIS_POINTS_BIG = BigInt(BASIS_POINTS);

export const RATIO_ZERO: Ratio = Object.freeze({ num: ZERO, den: ONE });
export const RATIO_ONE: Ratio = Object.freeze({ num: ONE, den: ONE });

function toBigInt(value: bigint | number, code: RatioErrorCode): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new RatioError(code);
  return BigInt(value);
}

function abs(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/** Greatest common divisor of |a| and |b| (Euclid); 0 only when both are 0. */
function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== ZERO) {
    const rest = x % y;
    x = y;
    y = rest;
  }
  return x;
}

/** Throws unless `r` has a positive denominator (a hand-built `{num, den}` may not). */
function assertRatio(r: Ratio): void {
  if (r.den <= ZERO) throw new RatioError('invalid_denominator');
}

/** A non-negative safe-integer weight or basis-point value, as a BigInt. */
function weightOf(value: number): bigint {
  const weight = toBigInt(value, 'invalid_weight');
  if (weight < ZERO) throw new RatioError('invalid_weight');
  return weight;
}

/**
 * The reduced rational `num / den` with a positive denominator. Number arguments must be safe integers
 * (milliseconds, counts, basis points); anything else throws `RatioError('not_an_integer')` rather than
 * being rounded. A zero denominator throws `RatioError('invalid_denominator')`.
 */
export function ratio(num: bigint | number, den: bigint | number): Ratio {
  let n = toBigInt(num, 'not_an_integer');
  let d = toBigInt(den, 'not_an_integer');
  if (d === ZERO) throw new RatioError('invalid_denominator');
  if (d < ZERO) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  return Object.freeze({ num: n / divisor, den: d / divisor });
}

/** −1, 0 or 1 as `a` is less than, equal to or greater than `b`, by cross-multiplication (exact). */
export function compareRatio(a: Ratio, b: Ratio): -1 | 0 | 1 {
  assertRatio(a);
  assertRatio(b);
  const left = a.num * b.den;
  const right = b.num * a.den;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** `r ≥ bp / 10000`, exactly: `10000 · num ≥ bp · den` (§5.3). `bp` is an integer basis-point value. */
export function ratioGteBasisPoints(r: Ratio, bp: number): boolean {
  assertRatio(r);
  return r.num * BASIS_POINTS_BIG >= weightOf(bp) * r.den;
}

/**
 * The exact weighted mean Σ wᵢ·vᵢ / Σ wᵢ (§5.3). Weights are non-negative safe integers (basis points).
 * The running sum is kept reduced, so the result is the same reduced Ratio in any term order. Throws
 * `RatioError('zero_weight_sum')` when the weights sum to 0 (including no terms at all).
 */
export function weightedScore(terms: readonly WeightedTerm[]): Ratio {
  let num = ZERO;
  let den = ONE;
  let total = ZERO;
  for (const { weightBp, value } of terms) {
    assertRatio(value);
    const weight = weightOf(weightBp);
    num = num * value.den + weight * value.num * den;
    den *= value.den;
    const divisor = gcd(num, den);
    num /= divisor;
    den /= divisor;
    total += weight;
  }
  if (total === ZERO) throw new RatioError('zero_weight_sum');
  return ratio(num, den * total);
}

/**
 * `r` as a display number rounded to 4 decimals, half away from zero (17/20 → 0.85, 787/792 → 0.9937).
 * For receipts and the UI only: never compared (§5.3). Exact in BigInt up to the final division.
 */
export function toDisplay(r: Ratio): number {
  assertRatio(r);
  const scaled = abs(r.num) * BASIS_POINTS_BIG;
  const rest = scaled % r.den;
  const quotient = scaled / r.den + (rest + rest >= r.den ? ONE : ZERO);
  const magnitude = Number(quotient) / BASIS_POINTS;
  return r.num < ZERO && quotient !== ZERO ? -magnitude : magnitude;
}
