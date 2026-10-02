/**
 * Perf gate, sprint 1 task 1.3 (qa_tester rule 7: a perf gate is a test, not a note; ledger_engineer rule 9):
 * candidate lookup for 5,000 claims over 50,000 observations must take under 2,000 ms in Node. The workload is
 * the bench's own (bench/core.ts: seeded mulberry32, no Math.random), so the committed bench number and this
 * gate measure the same thing. If this fails, fix the index, not the gate.
 *
 * Measured as tests/perf/measure.ts describes: the median CPU time (user + system) of three runs on freshly
 * built workloads, in a serial perf pass (vitest.perf.config.ts) where no other test competes for the CPU. CPU
 * time counts V8's GC and compiler threads, which only makes the gate stricter. Every run is logged.
 *
 * A fast wrong answer must not pass: every 25th claim is checked against a brute-force scan of every
 * observation, and the lookup must return a substantial number of candidates (no vacuous fast path).
 */
import { describe, expect, it } from 'vitest';

import { describeRuns, measure, RUNS } from './measure';

import {
  buildCoreWorkload,
  buildIndex,
  CLAIM_COUNT,
  GATE_MS,
  lookupAll,
  OBSERVATION_COUNT,
} from '../../../bench/core';
import { DEFAULT_POLICY } from '../../src/core/policy';
import type { Observation } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import { claimWindow, precisionBounds, type WindowClaim } from '../../src/core/window';

/** Every SAMPLE_EVERY-th claim is re-derived by brute force. */
const SAMPLE_EVERY = 25;

interface Parsed {
  readonly o: Observation;
  readonly t: number;
}

/** §4.1 by brute force over the whole observation list (no index, no buckets, no memo). */
function bruteForce(claim: WindowClaim, observations: readonly Parsed[]): string[] {
  const window = claimWindow(claim, DEFAULT_POLICY);
  if (window === null) return [];
  const firstSeenFrom =
    claim.type === 'calendar.created'
      ? precisionBounds(claim).startMs - DEFAULT_POLICY.windows.beforeClaimMin * MS_PER_MINUTE
      : Number.NEGATIVE_INFINITY;
  const groups = new Map<string, Observation[]>();
  for (const { o, t } of observations) {
    if (o.type !== claim.type || t < window.fromMs || t > window.toMs) continue;
    groups.set(o.contentHash, [...(groups.get(o.contentHash) ?? []), o]);
  }
  return [...groups.values()]
    .filter((group) => Math.min(...group.map((o) => Date.parse(o.observedAt))) >= firstSeenFrom)
    .map((group) => [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0])
    .filter((o): o is Observation => o !== undefined)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || (a.id < b.id ? -1 : 1))
    .map((o) => o.id);
}

describe('perf gate (task 1.3): 5,000 claims × 50,000 observations', () => {
  it(`candidate lookup for every claim takes a median < ${String(GATE_MS)} ms of CPU over ${String(RUNS)} fresh runs, and is right`, async () => {
    const measured = await measure(
      () => {
        const workload = buildCoreWorkload();
        return { workload, index: buildIndex(workload) };
      },
      async ({ workload, index }) => ({ workload, results: await lookupAll(workload, index) }),
    );
    console.log(describeRuns(`candidate lookup for ${String(CLAIM_COUNT)} claims`, measured));

    for (const { result } of measured.runs) {
      const { workload, results } = result;
      expect(workload.observations).toHaveLength(OBSERVATION_COUNT);
      expect(workload.claims).toHaveLength(CLAIM_COUNT);
      expect(results).toHaveLength(CLAIM_COUNT);
      const total = results.reduce((sum, list) => sum + list.length, 0);
      expect(total).toBeGreaterThan(CLAIM_COUNT * 10);
      const parsed = workload.observations.map((o) => ({ o, t: Date.parse(o.occurredAt) }));
      workload.claims.forEach((claim, i) => {
        if (i % SAMPLE_EVERY !== 0) return;
        expect(results[i]?.map((o) => o.id)).toEqual(bruteForce(claim, parsed));
      });
    }
    expect(measured.medianCpuMs).toBeLessThan(GATE_MS);
  }, 120_000);
});
