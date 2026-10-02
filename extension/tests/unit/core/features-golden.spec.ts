/**
 * Task 1.4 Done-when: the golden score cross-check (docs/grading.md §15). The golden files were written from
 * the contract alone, with every expected score computed by hand in basis points; features() must reproduce
 * each one exactly as a reduced fraction "p/q".
 *
 *  1. (The task's check.) Every scenario with exactly one claim and an expected non-null score: the maximum
 *     features().score over that claim's same-type observations inside claimWindow equals the expectation.
 *  2. (Stronger.) Every claim receipt with a non-null score in every batch scenario: the best score over the
 *     claim's own candidates (same type, inside claimWindow, seen by evaluatedAt, the v1.3 calendar.created
 *     first-seen rule: the earliest observedAt per contentHash ≥ start(p,t) − beforeClaimMin, minus
 *     observations the expectations assign to other claims or the scenario fixes),
 *     and, when the receipt names its assigned observation, that pair's score. The best candidate's cp.*
 *     reasons (§15: "cp.* from the best candidate only") must be exactly the receipt's cp.* reason codes.
 */
import { describe, expect, it } from 'vitest';

import { features } from '../../../src/core/features';
import { instantMs } from '../../../src/core/normalize';
import { loadPolicy, type Policy } from '../../../src/core/policy';
import { compareRatio, type Ratio } from '../../../src/core/ratio';
import type { Claim, Observation } from '../../../src/core/schema';
import { MS_PER_MINUTE } from '../../../src/core/units';
import { claimWindow, precisionStartMs } from '../../../src/core/window';
import { type LoadedScenario, loadScenario, scenarioFiles } from '../../golden/load';

const text = (value: Ratio): string => `${value.num}/${value.den}`;

interface ScoredClaim {
  readonly label: string;
  readonly loaded: LoadedScenario;
  readonly policy: Policy;
  readonly claim: Claim;
  readonly expected: string;
  readonly expectedCp: readonly string[];
  readonly assigned: readonly Observation[];
}

const LOADED = scenarioFiles().map(loadScenario);

function claimOf(loaded: LoadedScenario, ref: string): Claim {
  const claim = loaded.claims.get(ref);
  if (claim === undefined) throw new Error(`${loaded.file}: no claim ${ref}`);
  return claim;
}

function observationsOf(loaded: LoadedScenario, refs: readonly string[]): Observation[] {
  return refs.map((ref) => {
    const observation = loaded.observations.get(ref);
    if (observation === undefined) throw new Error(`${loaded.file}: no observation ${ref}`);
    return observation;
  });
}

/** Every claim receipt with an expected non-null score, with its policy and assigned observations. */
function scoredClaims(loaded: LoadedScenario): ScoredClaim[] {
  const policy = loadPolicy(loaded.policyJson);
  return loaded.expected.flatMap(({ expected }) => {
    const ref = expected.ref;
    if (ref === undefined || !ref.startsWith('c') || expected.score === null) return [];
    return [
      {
        label: `${loaded.file} ${ref}`,
        loaded,
        policy,
        claim: claimOf(loaded, ref),
        expected: expected.score,
        expectedCp: expected.reasonCodes.filter((code) => code.startsWith('cp.')),
        assigned: observationsOf(loaded, expected.observationRefs),
      },
    ];
  });
}

const ALL = LOADED.filter((loaded) => loaded.scenario.mode === 'batch').flatMap(scoredClaims);
/** Check 1 reads every scenario with exactly one claim, whatever its mode (the task's wording). */
const SINGLE = LOADED.filter((loaded) => loaded.scenario.input.claims.length === 1).flatMap(scoredClaims);
/** Counted from the raw expectations, so a filter above can never drop a scored scenario unnoticed. */
const SINGLE_SCORED = LOADED.filter((loaded) => loaded.scenario.input.claims.length === 1).flatMap((loaded) =>
  loaded.scenario.expect.filter((expected) => expected.score !== null),
).length;

function inWindow(claim: Claim, policy: Policy, observation: Observation): boolean {
  const window = claimWindow(claim, policy);
  if (window === null || observation.type !== claim.type) return false;
  const at = instantMs(observation.occurredAt);
  return window.fromMs <= at && at <= window.toMs;
}

interface Best {
  readonly score: Ratio;
  readonly reasonCodes: readonly string[];
}

/** The highest score; among equal scores the first by (occurredAt instant, id), as grade() orders them (§3). */
function best(item: ScoredClaim, observations: readonly Observation[]): Best | null {
  const ordered = [...observations].sort(
    (a, b) => instantMs(a.occurredAt) - instantMs(b.occurredAt) || (a.id < b.id ? -1 : 1),
  );
  return ordered
    .map((observation) => features(item.claim, observation, item.policy))
    .reduce<Best | null>(
      (top, next) => (top === null || compareRatio(next.score, top.score) > 0 ? next : top),
      null,
    );
}

const scoreText = (found: Best | null): string | null => (found === null ? null : text(found.score));

/** §4.1/§4.3 candidates as far as the expectations determine them (see the file comment, check 2). */
function ownCandidates(item: ScoredClaim): Observation[] {
  const { loaded, claim, policy } = item;
  const takenElsewhere = new Set(
    loaded.expected
      .filter(({ expected }) => expected.ref?.startsWith('c') === true && expected.ref !== refOf(item))
      .flatMap(({ observationIds }) => observationIds),
  );
  for (const pair of loaded.fixed) takenElsewhere.add(pair.observationId);
  const evaluatedMs = instantMs(loaded.evaluatedAt);
  const seen = [...loaded.observations.values()].filter((o) => instantMs(o.observedAt) <= evaluatedMs);
  // §4.1 v1.3: measured from the unit start, against the earliest sighting of each contentHash.
  const firstSeenFromMs = precisionStartMs(claim) - policy.windows.beforeClaimMin * MS_PER_MINUTE;
  const earliest = new Map<string, number>();
  for (const o of seen) {
    const at = instantMs(o.observedAt);
    earliest.set(o.contentHash, Math.min(earliest.get(o.contentHash) ?? at, at));
  }
  return seen.filter(
    (observation) =>
      inWindow(claim, policy, observation) &&
      !takenElsewhere.has(observation.id) &&
      (claim.type !== 'calendar.created' ||
        (earliest.get(observation.contentHash) ?? Number.NEGATIVE_INFINITY) >= firstSeenFromMs),
  );
}

function refOf(item: ScoredClaim): string {
  const entry = [...item.loaded.claims.entries()].find(([, claim]) => claim.id === item.claim.id);
  return entry?.[0] ?? '';
}

describe('golden cross-check 1: single-claim scenarios (task 1.4 Done-when)', () => {
  it('covers the single-claim scenarios that expect a score', () => {
    expect(SINGLE.length).toBeGreaterThanOrEqual(15);
    expect(SINGLE.length).toBe(SINGLE_SCORED);
  });

  it.each(SINGLE.map((item) => [item.label, item] as const))(
    '%s: the best score in the claim window is the expected one',
    (_label, item) => {
      const observations = [...item.loaded.observations.values()];
      const found = best(
        item,
        observations.filter((observation) => inWindow(item.claim, item.policy, observation)),
      );
      expect(scoreText(found)).toBe(item.expected);
    },
  );
});

describe('golden cross-check 2: every claim receipt that expects a score', () => {
  it('covers the multi-claim scenarios too', () => {
    expect(ALL.length).toBeGreaterThan(SINGLE.length + 30);
  });

  it.each(ALL.map((item) => [item.label, item] as const))(
    '%s: best over its own candidates, and its assigned pair, match the expected score',
    (_label, item) => {
      const found = best(item, ownCandidates(item));
      expect(scoreText(found)).toBe(item.expected);
      expect(found?.reasonCodes).toEqual(item.expectedCp);
      for (const observation of item.assigned) {
        expect(text(features(item.claim, observation, item.policy).score)).toBe(item.expected);
      }
    },
  );
});
