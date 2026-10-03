/**
 * SEC-2 (Sprint 1 security review; Hard Rules 4 and 6): `loadPolicy` is the only source of a `Policy`. Every
 * entry that grades or scores with a policy refuses an object the loader did not return, with
 * `PolicyError('policy_not_loaded')`. A copy edited in place is therefore never scored from memos computed under
 * its old values, and a hand-built object never stamps its receipts with another document's `policyHash`
 * (docs/grading.md §3: "the loaded, frozen policy").
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex, type ObservationIndex } from '../../../src/core/candidates';
import {
  applicableFeatures,
  features,
  isAssignable,
  isUnderspecified,
  pairScorer,
  RowScorer,
} from '../../../src/core/features';
import { grade, gradeClaim, gradeOrphan } from '../../../src/core/grade';
import {
  assertLoadedPolicy,
  DEFAULT_POLICY,
  loadPolicy,
  type Policy,
  PolicyError,
} from '../../../src/core/policy';
import { Activity, type Claim, type Observation } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../../golden/scenario-schema';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const CONTEXT = { priorSpendCents: 0 };
const NOT_LOADED = new PolicyError([], 'policy_not_loaded');

/** The security review's probe B: a claim at 14:02 and its send at 14:42, 39 minutes after the claimed minute. */
const CLAIM: Claim = buildClaim(
  ScenarioClaim.parse({
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    claimedAt: at('14:02'),
  }),
);
const SENT: Observation = buildObservation(
  ScenarioObservation.parse({
    ref: 'o1',
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    occurredAt: at('14:42'),
    observedAt: at('14:50'),
  }),
  [],
  EVAL,
  PolicyView.parse(defaultPolicyJson),
);
const GRANT = buildGrant({ agent: 'muse' }, EVAL);
/** A grant without the claim's type: rule `over_scope` matches before any feature of the claim is read. */
const NARROW_GRANT = buildGrant({ agent: 'muse', allowedTypes: ['calendar.created'] }, EVAL);
const COVERAGE = buildCoverage(
  [{ source: 'gmail.sent', lastSyncAt: at('14:55'), windowStart: at('09:00'), windowEnd: at('14:55') }],
  EVAL,
);

const gradeWith = (policy: Policy) => grade(CLAIM, [SENT], GRANT, policy, COVERAGE, CONTEXT);

/** Objects with every value of a valid policy that `loadPolicy` never returned. */
const COPIES: readonly (readonly [string, () => Policy])[] = [
  ['a spread copy', () => ({ ...DEFAULT_POLICY })],
  [
    'a spread copy with its own windows',
    () => ({ ...DEFAULT_POLICY, windows: { ...DEFAULT_POLICY.windows } }),
  ],
  ['a structured clone', () => structuredClone(DEFAULT_POLICY)],
  ['a frozen spread copy', () => Object.freeze({ ...DEFAULT_POLICY })],
  ['an object inheriting from a loaded policy', (): Policy => Object.create(DEFAULT_POLICY) as Policy],
];

/** Every exported entry that grades or scores with a policy, called with `policy`. */
const ENTRIES: readonly (readonly [string, (policy: Policy) => unknown])[] = [
  ['grade', gradeWith],
  [
    'grade (claim-less: no feature is read)',
    (policy) => grade(null, [SENT], GRANT, policy, COVERAGE, CONTEXT),
  ],
  ['gradeOrphan', (policy) => gradeOrphan(SENT, { coverage: COVERAGE }, GRANT, policy, CONTEXT)],
  [
    'gradeClaim (over scope: no feature is read)',
    (policy) =>
      gradeClaim(
        CLAIM,
        { coverage: COVERAGE, best: null, candidatesHash: () => '' },
        NARROW_GRANT,
        policy,
        CONTEXT,
      ),
  ],
  ['features', (policy) => features(CLAIM, SENT, policy)],
  ['pairScorer', (policy) => pairScorer(CLAIM, policy)],
  ['RowScorer', (policy) => new RowScorer(CLAIM, policy)],
  ['isAssignable', (policy) => isAssignable(CLAIM, policy)],
  [
    'isAssignable (a type with no sources)',
    (policy) => isAssignable({ ...CLAIM, type: 'message.sent' }, policy),
  ],
  ['applicableFeatures', (policy) => applicableFeatures(CLAIM, policy)],
  ['isUnderspecified', (policy) => isUnderspecified(CLAIM, policy)],
];

describe('loadPolicy registers what it returns, and only that', () => {
  it('DEFAULT_POLICY and every loadPolicy result pass the guard; each load is a new object', () => {
    const again = loadPolicy(defaultPolicyJson);
    expect(again).not.toBe(DEFAULT_POLICY);
    for (const policy of [DEFAULT_POLICY, again])
      expect(() => {
        assertLoadedPolicy(policy);
      }).not.toThrow();
    for (const [name, entry] of ENTRIES) expect(() => entry(again), name).not.toThrow();
  });

  it.each(COPIES)('%s is refused by every entry with policy_not_loaded', (_name, copy) => {
    for (const [name, entry] of ENTRIES) expect(() => entry(copy()), name).toThrow(NOT_LOADED);
    expect(() => {
      assertLoadedPolicy(copy());
    }).toThrow(NOT_LOADED);
  });
});

describe('the refusal comes first, as a closed-code PolicyError', () => {
  it('gradeBatch rejects a copy before reading anything, even an empty batch', async () => {
    const memory = createMemoryIndex([SENT], DEFAULT_POLICY.windows.afterClaimMin);
    let reads = 0;
    const index: ObservationIndex = {
      byTypeAndBucket: (...query) => {
        reads += 1;
        return memory.byTypeAndBucket(...query);
      },
      byCounterpartyToken: (...query) => {
        reads += 1;
        return memory.byCounterpartyToken(...query);
      },
    };
    const none = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [] });
    const run = (policy: Policy, claims: readonly Claim[]) =>
      gradeBatch(claims, index, [GRANT], policy, COVERAGE, { ...none, claims: [...claims] });
    await expect(run({ ...DEFAULT_POLICY }, [CLAIM])).rejects.toThrow(NOT_LOADED);
    await expect(run({ ...DEFAULT_POLICY }, [])).rejects.toThrow(NOT_LOADED);
    expect(reads).toBe(0);
    // The loaded policy reads the index (orphans, candidates), so a refusal after any read would show above.
    await run(DEFAULT_POLICY, []);
    expect(reads).toBeGreaterThan(0);
    const [graded] = await run(DEFAULT_POLICY, [CLAIM]);
    expect(graded?.receipt).toEqual(gradeWith(DEFAULT_POLICY));
  });

  it('the error carries the closed code, no issues and no value', () => {
    let caught: unknown;
    try {
      assertLoadedPolicy({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PolicyError);
    if (!(caught instanceof PolicyError)) return;
    expect([caught.code, caught.name, caught.message]).toEqual([
      'policy_not_loaded',
      'PolicyError',
      'policy: policy_not_loaded',
    ]);
    expect(caught.issues).toEqual([]);
    expect(Object.isFrozen(caught.issues)).toBe(true);
  });
});

describe('probe B: a policy edited after grading is never scored from stale memos', () => {
  it('a copy edited in place is refused before and after the edit', () => {
    const windows: Mutable<Policy['windows']> = { ...DEFAULT_POLICY.windows };
    const copy: Policy = { ...DEFAULT_POLICY, windows };
    expect(() => gradeWith(copy)).toThrow(NOT_LOADED);
    windows.afterClaimMin = 10;
    expect(() => gradeWith(copy)).toThrow(NOT_LOADED);
  });

  it('a loaded policy cannot be edited in place, so it grades the same afterwards', () => {
    const policy = loadPolicy(defaultPolicyJson);
    const before = gradeWith(policy);
    expect(() => {
      (policy.windows as Mutable<Policy['windows']>).afterClaimMin = 10;
    }).toThrow(TypeError);
    expect(gradeWith(policy)).toEqual(before);
  });

  it('the other window is a document of its own: the score its windows give, and its own hash', () => {
    const narrow = loadPolicy({
      ...defaultPolicyJson,
      windows: { ...defaultPolicyJson.windows, afterClaimMin: 10 },
    });
    const shipped = gradeWith(DEFAULT_POLICY);
    expect([shipped.grade, shipped.signals.timeProximity, shipped.signals.score]).toEqual([
      'PARTIAL',
      0.1364,
      0.7601,
    ]);
    const { signals } = features(CLAIM, SENT, narrow);
    expect([signals.timeProximity, signals.score]).toEqual([0, 0.7222]);
    const unseen = (policy: Policy) => grade(CLAIM, [], GRANT, policy, COVERAGE, CONTEXT);
    const [before, after] = [unseen(DEFAULT_POLICY), unseen(narrow)];
    expect([before.policyHash, after.policyHash]).toEqual([DEFAULT_POLICY.policyHash, narrow.policyHash]);
    expect(after.policyHash).not.toBe(before.policyHash);
    expect(after.inputsHash).not.toBe(before.inputsHash);
  });
});
