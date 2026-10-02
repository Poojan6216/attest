/**
 * gradeBatch is deterministic (Hard Rule 4; docs/grading.md §3, §4.2): its output is ordered by receipt id and
 * does not depend on the order of any input list, on the order an index returns rows in, or on how much an
 * index over-returns (§4.2 lets reads over-return; candidates() and orphan discovery filter exactly). It reads
 * its inputs and never changes them. Exercised over every golden batch scenario.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { seededRandom } from '../../../../bench/core';
import { type BatchFixed, type BatchReceipt, gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex, type ObservationIndex } from '../../../src/core/candidates';
import { canonicalJson } from '../../../src/core/hash';
import { loadPolicy } from '../../../src/core/policy';
import type { Activity, Coverage, Observation } from '../../../src/core/schema';
import { type LoadedScenario, loadScenario, scenarioFiles } from '../../golden/load';

const BUCKET_MINUTES = 15;
const BATCH: readonly LoadedScenario[] = scenarioFiles()
  .map((file) => loadScenario(file))
  .filter((loaded) => loaded.gradeCall === undefined);

type IndexMode = 'memory' | 'reversed' | 'everything';

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const held = out[i];
    const swap = out[j];
    if (held === undefined || swap === undefined) continue;
    out[i] = swap;
    out[j] = held;
  }
  return out;
}

/** An index with the given return behaviour over `observations` (kept in the order given). */
function indexOf(observations: readonly Observation[], mode: IndexMode): ObservationIndex {
  const memory = createMemoryIndex(observations, BUCKET_MINUTES);
  if (mode === 'memory') return memory;
  if (mode === 'everything') {
    const all = async () => Promise.resolve(observations);
    return { byTypeAndBucket: all, byCounterpartyToken: all };
  }
  return {
    byTypeAndBucket: async (type, from, to) => [...(await memory.byTypeAndBucket(type, from, to))].reverse(),
    byCounterpartyToken: async (token, from, to) =>
      [...(await memory.byCounterpartyToken(token, from, to))].reverse(),
  };
}

interface Inputs {
  readonly claims: LoadedScenario['batchClaims'];
  readonly observations: readonly Observation[];
  readonly grants: LoadedScenario['grants'];
  readonly coverage: Coverage;
  readonly activity: Activity;
  readonly fixed: readonly BatchFixed[];
}

/** The gradeBatch inputs of a scenario, and nothing else of it (the loader also holds maps and expectations). */
function inputsOf(loaded: LoadedScenario): Inputs {
  const { grants, coverage, activity, fixed } = loaded;
  const observations = [...loaded.observations.values()];
  return { claims: loaded.batchClaims, observations, grants, coverage, activity, fixed };
}

/** Every list of the inputs in a seeded random order (the sets are unchanged). */
function permuted(inputs: Inputs, seed: number): Inputs {
  const random = seededRandom(seed);
  const { activity, coverage } = inputs;
  return {
    claims: shuffled(inputs.claims, random),
    observations: shuffled(inputs.observations, random),
    grants: shuffled(inputs.grants, random),
    coverage: { ...coverage, observers: shuffled(coverage.observers, random) },
    activity: {
      sessions: shuffled(activity.sessions, random),
      idle: shuffled(activity.idle, random),
      entries: shuffled(activity.entries, random),
      adapterSyncs: shuffled(activity.adapterSyncs, random),
      claims: shuffled(activity.claims, random),
    },
    fixed: shuffled(inputs.fixed, random),
  };
}

/** gradeBatch's whole result: every receipt and the inputs it was graded with (§3). */
async function grade(loaded: LoadedScenario, inputs: Inputs, mode: IndexMode): Promise<BatchReceipt[]> {
  const index = indexOf(inputs.observations, mode);
  const policy = loadPolicy(loaded.policyJson);
  const { claims, grants, coverage, activity, fixed } = inputs;
  return gradeBatch(claims, index, grants, policy, coverage, activity, fixed);
}

describe('gradeBatch determinism (Hard Rule 4)', () => {
  it('runs over the golden batch scenarios (the fixture set this property draws from)', () => {
    expect(BATCH.length).toBeGreaterThanOrEqual(60);
  });

  it('orders every result by receipt id, strictly ascending', async () => {
    for (const loaded of BATCH) {
      const ids = (await grade(loaded, inputsOf(loaded), 'memory')).map(({ receipt }) => receipt.id);
      expect(ids, loaded.file).toEqual([...ids].sort());
      expect(new Set(ids).size, loaded.file).toBe(ids.length);
    }
  });

  it('gives the same receipts and inputs for any input order, index return order and over-return (1,000 runs)', async () => {
    const baselines = await Promise.all(
      BATCH.map(async (loaded) => canonicalJson(await grade(loaded, inputsOf(loaded), 'memory'))),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: BATCH.length - 1 }),
        fc.nat(),
        fc.constantFrom<IndexMode>('memory', 'reversed', 'everything'),
        async (which, seed, mode) => {
          const loaded = BATCH[which];
          if (loaded === undefined) throw new Error('no scenario');
          const graded = await grade(loaded, permuted(inputsOf(loaded), seed), mode);
          expect(canonicalJson(graded), loaded.file).toBe(baselines[which]);
        },
      ),
      { numRuns: 1_000 },
    );
  }, 120_000);

  it('never changes its inputs, and a second run gives the same receipts', async () => {
    for (const loaded of BATCH) {
      const inputs = inputsOf(loaded);
      const before = canonicalJson(inputs);
      const first = canonicalJson(await grade(loaded, inputs, 'memory'));
      expect(canonicalJson(inputs), loaded.file).toBe(before);
      expect(canonicalJson(await grade(loaded, inputs, 'memory')), loaded.file).toBe(first);
    }
  });
});
