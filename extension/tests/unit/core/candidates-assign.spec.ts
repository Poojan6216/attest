/**
 * assign() and exclusiveCandidates() (docs/grading.md §4.3): best score first by exact comparison; ties by
 * earlier claimedAt instant, then claim id, then observation id; fixed pairs first and never moved; one-to-one
 * both ways; pairs below thresholds.partial never consume a claim or an observation.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { assign, type ScoredPair } from '../../../src/core/candidates';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { type Ratio, ratio } from '../../../src/core/ratio';
import { Ulid } from '../../../src/core/schema';

/** Decimal digits are valid Crockford base32, so zero-padded numbers are ULIDs that sort numerically. */
const id = (n: number): Ulid => Ulid.parse(String(n).padStart(26, '0'));
const C = (n: number) => id(100 + n);
const O = (n: number) => id(200 + n);

const T0 = Date.parse('2026-10-06T14:02:00-04:00');

const pair = (claim: number, observation: number, score: Ratio, claimedAtMs = T0): ScoredPair => ({
  claimId: C(claim),
  claimedAtMs,
  observationId: O(observation),
  score,
});

/** No observation fixed as taken: `taken` is required (§4.3 v1.3 `assign(pairs, policy, fixed, taken)`). */
const NONE: ReadonlySet<Ulid> = new Set();

const entries = (map: ReadonlyMap<Ulid, Ulid>) => [...map];
const run = (pairs: readonly ScoredPair[]) => entries(assign(pairs, DEFAULT_POLICY, [], NONE));

describe('assign: best score first, exact', () => {
  it('the better-scoring claim takes a shared observation, whatever the input order', () => {
    const pairs = [pair(1, 1, ratio(3, 4)), pair(2, 1, ratio(9, 10))];
    expect(run(pairs)).toEqual([[O(1), C(2)]]);
    expect(run([...pairs].reverse())).toEqual([[O(1), C(2)]]);
  });

  it('scores that differ beyond double precision are still ordered exactly', () => {
    const x = 10n ** 17n;
    const lower = ratio(x, x + 1n);
    const higher = ratio(x + 1n, x + 2n);
    expect(Number(lower.num) / Number(lower.den)).toBe(Number(higher.num) / Number(higher.den));
    // The lower score belongs to the earlier claim, so a floating-point tie would hand it the observation.
    expect(run([pair(1, 1, lower, T0), pair(2, 1, higher, T0 + 1)])).toEqual([[O(1), C(2)]]);
  });

  it('a claim that loses its best observation takes its next one', () => {
    const pairs = [pair(1, 1, ratio(1, 1)), pair(2, 1, ratio(9, 10)), pair(2, 2, ratio(6, 10))];
    expect(run(pairs)).toEqual([
      [O(1), C(1)],
      [O(2), C(2)],
    ]);
  });
});

describe('assign: tie-breaks', () => {
  it('equal scores: the earlier claimedAt instant wins, even with a higher claim id', () => {
    expect(run([pair(1, 1, ratio(4, 5), T0 + 1), pair(2, 1, ratio(4, 5), T0)])).toEqual([[O(1), C(2)]]);
  });

  it('equal values in different representations tie (1/2 = 2/4) and fall to claimedAt', () => {
    const unreduced: Ratio = { num: 2n, den: 4n };
    expect(run([pair(1, 1, ratio(1, 2), T0 + 1), pair(2, 1, unreduced, T0)])).toEqual([[O(1), C(2)]]);
  });

  it('equal scores and claimedAt: the lower claim id wins', () => {
    expect(run([pair(2, 1, ratio(4, 5)), pair(1, 1, ratio(4, 5))])).toEqual([[O(1), C(1)]]);
  });

  it('one claim, equal scores for two observations: the lower observation id; the other stays free', () => {
    const pairs = [pair(1, 2, ratio(4, 5)), pair(1, 1, ratio(4, 5)), pair(2, 2, ratio(3, 5))];
    expect(run(pairs)).toEqual([
      [O(1), C(1)],
      [O(2), C(2)],
    ]);
  });
});

describe('assign: thresholds.partial', () => {
  it('a score of exactly partial (1/2) is assigned; 4999/10000 is not', () => {
    expect(run([pair(1, 1, ratio(1, 2))])).toEqual([[O(1), C(1)]]);
    expect(run([pair(1, 1, ratio(4999, 10_000))])).toEqual([]);
  });

  it('a score below partial by less than double precision is not assigned (exact, never floating point)', () => {
    const partialBp = BigInt(DEFAULT_POLICY.bp.thresholds.partial);
    const x = 10n ** 13n;
    const justBelow = ratio(partialBp * x - 1n, 10_000n * x);
    // In doubles the score equals the threshold, so a floating-point comparison would assign it.
    expect(Number(justBelow.num) / Number(justBelow.den)).toBe(Number(partialBp) / 10_000);
    expect(run([pair(1, 1, justBelow)])).toEqual([]);
    expect(run([pair(1, 1, ratio(partialBp * x, 10_000n * x))])).toEqual([[O(1), C(1)]]);
  });

  it('a pair below partial never consumes an observation or a claim', () => {
    const pairs = [pair(1, 1, ratio(49, 100), T0 - 1), pair(2, 1, ratio(1, 2)), pair(3, 2, ratio(3, 10))];
    expect(run(pairs)).toEqual([[O(1), C(2)]]);
    expect(run([pair(1, 1, ratio(3, 10)), pair(1, 2, ratio(6, 10))])).toEqual([[O(2), C(1)]]);
  });

  it('follows the policy threshold with no code change', () => {
    const lenient = loadPolicy({ ...defaultPolicyJson, thresholds: { verified: 0.85, partial: 0.4 } });
    expect(entries(assign([pair(1, 1, ratio(49, 100))], lenient, [], NONE))).toEqual([[O(1), C(1)]]);
  });
});

describe('assign: one-to-one both ways', () => {
  it('each observation goes to one claim and each claim takes one observation', () => {
    const pairs = [1, 2, 3].flatMap((c) => [1, 2].map((o) => pair(c, o, ratio(9 - c - o, 10))));
    const result = run(pairs);
    expect(result).toEqual([
      [O(1), C(1)],
      [O(2), C(2)],
    ]);
    expect(new Set(result.map(([, claim]) => claim)).size).toBe(result.length);
  });

  it('returns entries ordered by observation id, whatever the input order', () => {
    const pairs = [pair(3, 1, ratio(1, 1)), pair(1, 3, ratio(1, 1)), pair(2, 2, ratio(1, 1))];
    expect(run(pairs).map(([observation]) => observation)).toEqual([O(1), O(2), O(3)]);
  });

  it('never reorders or edits its inputs (frozen arrays are accepted)', () => {
    const pairs = Object.freeze([pair(2, 1, ratio(1, 2)), pair(1, 1, ratio(1, 2)), pair(1, 2, ratio(3, 4))]);
    const fixed = Object.freeze([{ observationId: O(9), claimId: C(9) }]);
    expect(entries(assign(pairs, DEFAULT_POLICY, fixed, NONE))).toEqual([
      [O(1), C(2)],
      [O(2), C(1)],
      [O(9), C(9)],
    ]);
    expect(pairs.map((p) => p.claimId)).toEqual([C(2), C(1), C(1)]);
  });
});
