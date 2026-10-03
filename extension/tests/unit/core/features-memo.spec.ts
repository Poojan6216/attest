/**
 * The per-object memos behind features() (src/core/features-memo.ts; task 1.5 perf gate). A memo may only ever
 * save work, never change a result (Hard Rule 4):
 *  - `memoised` returns the stored value while every input is the same value (`Object.is`), recomputes as soon
 *    as one differs, keeps keys apart, and stores nothing when the computation throws;
 *  - features() on a claim or an observation changed in place, and under each of several loaded policies in turn,
 *    scores exactly like features() on fresh copies, so no object is ever scored from its old fields.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { type FeatureClaim, type FeatureObservation, features } from '../../../src/core/features';
import { type Memo, memoised } from '../../../src/core/features-memo';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const AT = '2026-10-06T14:02:00-04:00';

describe('memoised()', () => {
  it('computes once while the inputs stay the same, and again as soon as one changes', () => {
    const memo: Memo<object, number> = new WeakMap();
    const key = {};
    let calls = 0;
    const compute = (value: number) => () => {
      calls += 1;
      return value;
    };
    expect(memoised(memo, key, ['a', 1], compute(10))).toBe(10);
    expect(memoised(memo, key, ['a', 1], compute(20))).toBe(10);
    expect(calls).toBe(1);
    expect(memoised(memo, key, ['b', 1], compute(30))).toBe(30);
    expect(memoised(memo, key, ['b', 1, undefined], compute(40))).toBe(40);
    expect(calls).toBe(3);
  });

  it('compares inputs with Object.is: an equal-looking new array is a different input', () => {
    const memo: Memo<object, string> = new WeakMap();
    const key = {};
    const words = ['the'];
    expect(memoised(memo, key, [words], () => 'first')).toBe('first');
    expect(memoised(memo, key, [words], () => 'second')).toBe('first');
    expect(memoised(memo, key, [['the']], () => 'third')).toBe('third');
    expect(memoised(memo, key, [Number.NaN], () => 'nan')).toBe('nan');
    expect(memoised(memo, key, [Number.NaN], () => 'other')).toBe('nan');
  });

  it('keeps each key apart', () => {
    const memo: Memo<object, string> = new WeakMap();
    const a = {};
    const b = {};
    expect(memoised(memo, a, ['x'], () => 'a')).toBe('a');
    expect(memoised(memo, b, ['x'], () => 'b')).toBe('b');
    expect(memoised(memo, a, ['x'], () => 'again')).toBe('a');
  });

  it('stores nothing when the computation throws, so the next call throws again', () => {
    const memo: Memo<object, number> = new WeakMap();
    const key = {};
    const fail = (): number => {
      throw new RangeError('no');
    };
    expect(() => memoised(memo, key, ['x'], fail)).toThrow(RangeError);
    expect(() => memoised(memo, key, ['x'], fail)).toThrow(RangeError);
    expect(memoised(memo, key, ['x'], () => 7)).toBe(7);
  });
});

/** features() of `claim` and `observation`, and of fresh copies the memos have never seen. */
function bothWays(claim: FeatureClaim, observation: FeatureObservation, policy: Policy) {
  return {
    memo: features(claim, observation, policy),
    fresh: features(structuredClone(claim), structuredClone(observation), policy),
  };
}

describe('features() never scores a claim from fields it no longer has', () => {
  it('a claim edited in place, one field at a time', () => {
    const claim: Mutable<FeatureClaim> = {
      type: 'email.sent',
      claimedAt: AT,
      claimedAtPrecision: 'minute',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
    };
    const observation: FeatureObservation = {
      occurredAt: '2026-10-06T14:20:00-04:00',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
    };
    const edits: readonly Partial<FeatureClaim>[] = [
      { subjectHint: 'budget' },
      { counterparty: 'Priya' },
      { counterparty: 'raj@company.com' },
      { claimedAt: '2026-10-06T14:19:00-04:00' },
      { claimedAtPrecision: 'hour' },
      { claimedAtPrecision: 'day', claimedAtEnd: '2026-10-07T00:00:00-04:00' },
      { type: 'calendar.created' },
      { targetAt: '2026-10-06T14:20:00-04:00' },
      { type: 'purchase.made', counterparty: 'Acme', amountCents: 500 },
      { currency: 'USD' },
      { amountCents: 600 },
    ];
    let previous = features(claim, observation, DEFAULT_POLICY);
    for (const edit of edits) {
      Object.assign(claim, edit);
      const { memo, fresh } = bothWays(claim, observation, DEFAULT_POLICY);
      expect(memo).toStrictEqual(fresh);
      previous = memo;
    }
    expect(previous.signals).toHaveProperty('amountExact');
  });
});

describe('features() never scores an observation from fields it no longer has', () => {
  it('an observation edited in place, one field at a time', () => {
    const claim: FeatureClaim = {
      type: 'email.sent',
      claimedAt: AT,
      claimedAtPrecision: 'minute',
      counterparty: 'Priya',
      subjectHint: 'Q3 deck',
    };
    const observation: Mutable<FeatureObservation> = {
      occurredAt: AT,
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
    };
    const purchase: FeatureClaim = { ...claim, type: 'purchase.made', counterparty: 'Acme Store' };
    const edits: readonly Partial<FeatureObservation>[] = [
      { occurredAt: '2026-10-06T14:40:00-04:00' },
      { counterparty: 'raj@company.com' },
      { counterparty: undefined },
      { subjectHint: 'budget' },
      { merchant: 'Acme' },
      { merchant: 'Acme Store' },
    ];
    for (const edit of edits) {
      Object.assign(observation, edit);
      for (const scored of [claim, purchase]) {
        const { memo, fresh } = bothWays(scored, observation, DEFAULT_POLICY);
        expect(memo).toStrictEqual(fresh);
      }
    }
  });
});

describe('features() under another policy never reuses facts read under the last one', () => {
  it('one claim and one observation scored under policies with other stop words and windows', () => {
    const claim: FeatureClaim = {
      type: 'email.sent',
      claimedAt: AT,
      claimedAtPrecision: 'minute',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck review',
    };
    const observation: FeatureObservation = {
      occurredAt: '2026-10-06T14:30:00-04:00',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
    };
    const stopReview = loadPolicy({
      ...defaultPolicyJson,
      normalize: { stopWords: [...defaultPolicyJson.normalize.stopWords, 'review'] },
    });
    const wider = loadPolicy({
      ...defaultPolicyJson,
      windows: { ...defaultPolicyJson.windows, afterClaimMin: 90 },
    });
    // The same document loaded again: equal values in new objects (a hand-built copy is refused, SEC-2).
    const widerAgain = loadPolicy({
      ...defaultPolicyJson,
      windows: { ...defaultPolicyJson.windows, afterClaimMin: 90 },
    });
    const policies = [DEFAULT_POLICY, stopReview, wider, DEFAULT_POLICY, widerAgain, DEFAULT_POLICY];
    const scores = policies.map((policy) => {
      const { memo, fresh } = bothWays(claim, observation, policy);
      expect(memo).toStrictEqual(fresh);
      return memo.signals;
    });
    // Each policy really changes the pair's values, so a memo keyed on the claim alone would be caught.
    expect(scores[1]?.subjectOverlap).not.toBe(scores[0]?.subjectOverlap);
    expect(scores[2]?.timeProximity).not.toBe(scores[0]?.timeProximity);
    expect(scores[3]).toStrictEqual(scores[0]);
    expect(scores[4]?.timeProximity).toBe(scores[2]?.timeProximity);
    expect(scores[5]).toStrictEqual(scores[0]);
  });
});
