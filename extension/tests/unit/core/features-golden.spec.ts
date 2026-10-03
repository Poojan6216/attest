/**
 * Task 1.4 Done-when: the golden score cross-check (docs/grading.md §15). The golden files were written from
 * the contract alone, with every expected score computed by hand in basis points; features() must reproduce
 * each one exactly as a reduced fraction "p/q".
 *
 * Both checks read the observations the receipt's grading could see (§3, §4.1): same type, inside claimWindow,
 * observed by the instant the receipt was graded at (the first pass, or its last applied `regrade`, §8: a regrade
 * sees what was observed by its own `evaluatedAt`, and nothing observed later), and for `calendar.created` first
 * seen no earlier than start(p,t) − beforeClaimMin (the earliest observedAt per contentHash, v1.3). Among equal
 * scores the best is the lower observation id (§8), whatever the occurrence order.
 *
 *  1. (The task's check.) Every scenario with exactly one claim and an expected non-null score: the maximum
 *     features().score over those observations equals the expectation.
 *  2. (Stronger.) Every claim receipt with a non-null score in every batch scenario: the best score over the
 *     claim's own candidates (those observations minus the ones the expectations assign to other claims or the
 *     scenario fixes), and, when the receipt names its assigned observation, that pair's score. The best
 *     candidate's cp.* reasons (§15: "cp.* from the best candidate only") must be exactly the receipt's cp.*
 *     reason codes.
 *
 * Scenario 95 pins the grading instant (its regrade sees a row first observed after the first pass, and ignores
 * a better row observed after the regrade); 96 pins the tie rule (tied candidates whose cp.* codes differ, the
 * lower id occurring later); 97 pins the first-seen rule (a pre-existing event that outscores the new one).
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
  /** The instant the receipt's current version was graded at (`gradedAt`). */
  readonly evaluatedAt: string;
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

/**
 * The instant a receipt's current version was graded at (§8): its last applied `regrade` event, else the first
 * pass. A regrade sees what was observed by its own `evaluatedAt`, so its candidates are read at that instant.
 */
function gradedAt(loaded: LoadedScenario, receiptId: string): string {
  let at: string = loaded.evaluatedAt;
  for (const event of loaded.events) {
    if (event.event !== 'regrade' || event.rejected || event.deleted) continue;
    if (event.receiptId === receiptId) at = event.evaluatedAt;
  }
  return at;
}

/** Every claim receipt with an expected non-null score, with its policy and assigned observations. */
function scoredClaims(loaded: LoadedScenario): ScoredClaim[] {
  const policy = loadPolicy(loaded.policyJson);
  return loaded.expected.flatMap(({ expected, receiptId }) => {
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
        evaluatedAt: gradedAt(loaded, receiptId),
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

/**
 * The highest score; among equal scores the lower observation id, as grade() breaks ties (§8: "ties broken by
 * observation id", grade-best.ts `beats`), whatever the occurrence order.
 */
function best(item: ScoredClaim, observations: readonly Observation[]): Best | null {
  const ordered = [...observations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ordered
    .map((observation) => features(item.claim, observation, item.policy))
    .reduce<Best | null>(
      (top, next) => (top === null || compareRatio(next.score, top.score) > 0 ? next : top),
      null,
    );
}

const scoreText = (found: Best | null): string | null => (found === null ? null : text(found.score));

/**
 * §3/§4.1: the observations the receipt's grading could see (see the file comment): observed by `item.evaluatedAt`,
 * of the claim's type inside its window, and for calendar.created first seen at or after start(p,t) − beforeClaimMin.
 */
function seenCandidates(item: ScoredClaim): Observation[] {
  const { loaded, claim, policy } = item;
  const evaluatedMs = instantMs(item.evaluatedAt);
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
      (claim.type !== 'calendar.created' ||
        (earliest.get(observation.contentHash) ?? Number.NEGATIVE_INFINITY) >= firstSeenFromMs),
  );
}

/** §4.1/§4.3 candidates as far as the expectations determine them (see the file comment, check 2). */
function ownCandidates(item: ScoredClaim): Observation[] {
  const { loaded } = item;
  const takenElsewhere = new Set(
    loaded.expected
      .filter(({ expected }) => expected.ref?.startsWith('c') === true && expected.ref !== refOf(item))
      .flatMap(({ observationIds }) => observationIds),
  );
  for (const pair of loaded.fixed) takenElsewhere.add(pair.observationId);
  return seenCandidates(item).filter((observation) => !takenElsewhere.has(observation.id));
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
    '%s: the best score in the claim window, among the rows seen by its grading, is the expected one',
    (_label, item) => {
      expect(scoreText(best(item, seenCandidates(item)))).toBe(item.expected);
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
