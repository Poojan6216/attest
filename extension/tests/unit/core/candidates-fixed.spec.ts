/**
 * Fixed pre-assignments, taken observations and exclusiveCandidates (docs/grading.md §4.3): FINAL and
 * USER_OVERRIDDEN pairs are taken first and never moved; an observation fixed as taken by an overridden
 * UNASKED receipt is never assigned; a claim's candidates for grade() exclude other claims' observations.
 */
import { describe, expect, it } from 'vitest';

import {
  assign,
  CandidatesError,
  exclusiveCandidates,
  type FixedPair,
  type ScoredPair,
} from '../../../src/core/candidates';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { type Ratio, ratio } from '../../../src/core/ratio';
import { Ulid } from '../../../src/core/schema';

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

const fix = (observation: number, claim: number): FixedPair => ({
  observationId: O(observation),
  claimId: C(claim),
});

describe('assign: fixed pairs', () => {
  it('are taken first and never moved, even by a better score', () => {
    const result = assign([pair(2, 1, ratio(1, 1))], DEFAULT_POLICY, [fix(1, 1)], NONE);
    expect([...result]).toEqual([[O(1), C(1)]]);
  });

  it('a fixed claim takes no second observation; the next claim gets it', () => {
    const pairs = [pair(1, 2, ratio(1, 1)), pair(3, 2, ratio(3, 4))];
    expect([...assign(pairs, DEFAULT_POLICY, [fix(1, 1)], NONE)]).toEqual([
      [O(1), C(1)],
      [O(2), C(3)],
    ]);
  });

  it('are kept with no scored pair at all (an override keeps its stored observation)', () => {
    expect([...assign([], DEFAULT_POLICY, [fix(5, 4)], NONE)]).toEqual([[O(5), C(4)]]);
  });

  it('a repeated identical fixed pair is harmless', () => {
    expect([...assign([], DEFAULT_POLICY, [fix(1, 1), fix(1, 1)], NONE)]).toEqual([[O(1), C(1)]]);
  });

  it('fixed pairs that are not one-to-one fail loud (a corrupt ledger never grades silently)', () => {
    expect(() => assign([], DEFAULT_POLICY, [fix(1, 1), fix(1, 2)], NONE)).toThrow(CandidatesError);
    expect(() => assign([], DEFAULT_POLICY, [fix(1, 1), fix(2, 1)], NONE)).toThrow(
      expect.objectContaining({ code: 'fixed_conflict' }),
    );
  });
});

describe('assign: taken observations and bad input', () => {
  it('an observation fixed as taken is never assigned; the claim takes its next candidate', () => {
    const pairs = [pair(1, 1, ratio(1, 1)), pair(1, 2, ratio(3, 4))];
    expect([...assign(pairs, DEFAULT_POLICY, [], new Set([O(1)]))]).toEqual([[O(2), C(1)]]);
  });

  it("a taken observation is never assigned, even as every claim's best and only candidate", () => {
    const pairs = [pair(1, 1, ratio(1, 1)), pair(2, 1, ratio(1, 1), T0 - 1), pair(3, 1, ratio(9, 10))];
    expect([...assign(pairs, DEFAULT_POLICY, [], new Set([O(1)]))]).toEqual([]);
  });

  it('a fixed pair is kept as given even when its observation is also taken (Decisions [1.3])', () => {
    const result = assign([pair(2, 1, ratio(1, 1))], DEFAULT_POLICY, [fix(1, 1)], new Set([O(1)]));
    expect([...result]).toEqual([[O(1), C(1)]]);
  });

  it.each([Number.NaN, 1.5, Number.POSITIVE_INFINITY])('rejects claimedAtMs %s', (claimedAtMs) => {
    expect(() => assign([pair(1, 1, ratio(1, 1), claimedAtMs)], DEFAULT_POLICY, [], NONE)).toThrow(
      expect.objectContaining({ code: 'invalid_pair' }),
    );
  });

  it('rejects a hand-built score with a zero denominator (ratio.ts)', () => {
    expect(() => assign([pair(1, 1, { num: 1n, den: 0n })], DEFAULT_POLICY, [], NONE)).toThrow();
  });
});

describe('exclusiveCandidates', () => {
  const candidates = [1, 2, 3, 4, 5].map((n) => ({ id: O(n) }));
  const assignment = new Map([
    [O(1), C(1)],
    [O(2), C(2)],
    [O(5), C(1)],
  ]);

  it('drops observations assigned to other claims or fixed as taken, keeps own and free ones in order', () => {
    expect(exclusiveCandidates(C(1), candidates, assignment, new Set([O(3)]))).toEqual([
      { id: O(1) },
      { id: O(4) },
      { id: O(5) },
    ]);
  });

  it('for a claim with no assignment, only free observations remain', () => {
    expect(exclusiveCandidates(C(9), candidates, assignment, new Set())).toEqual([
      { id: O(3) },
      { id: O(4) },
    ]);
  });

  it('a taken observation is excluded even from the claim it is assigned to', () => {
    expect(exclusiveCandidates(C(2), candidates, assignment, new Set([O(2)]))).toEqual([
      { id: O(3) },
      { id: O(4) },
    ]);
  });
});
