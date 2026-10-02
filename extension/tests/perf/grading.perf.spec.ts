/**
 * Perf gate, sprint 1 task 1.5 (qa_tester rule 7: a perf gate is a test, not a note; ledger_engineer rule 9):
 * `gradeBatch` over 5,000 claims and 50,000 observations must take under 2,000 ms in Node. The workload is the
 * bench's own (bench/core.ts `buildGradingWorkload`: the task 1.3 observations and claim timings, seeded
 * mulberry32, no Math.random), so the committed bench number and this gate measure the same thing.
 *
 * Measured as tests/perf/measure.ts describes: the median CPU time of three runs on freshly built workloads,
 * in a serial perf pass (vitest.perf.config.ts) where no other test competes for the CPU. Every run's CPU and
 * wall time is logged, the cold first run included.
 *
 * A fast wrong answer must not pass: every claim gets exactly one receipt, evidence is one-to-one, the result
 * holds real VERIFIED, NOT_FOUND and UNASKED receipts, and every 50th claim's receipt equals `grade()` called
 * directly on its candidates found by brute force (no index), minus the observations other receipts hold.
 */
import { describe, expect, it } from 'vitest';

import { describeRuns, measure, RUNS } from './measure';

import {
  buildGradingWorkload,
  BUCKET_MINUTES,
  CLAIM_COUNT,
  GATE_MS,
  gradeAll,
  type GradingWorkload,
  OBSERVATION_COUNT,
} from '../../../bench/core';
import { createMemoryIndex } from '../../src/core/candidates';
import { isAssignable } from '../../src/core/features';
import { grade } from '../../src/core/grade';
import { canonicalJson } from '../../src/core/hash';
import { DEFAULT_POLICY } from '../../src/core/policy';
import type { Claim, Observation, Receipt } from '../../src/core/schema';
import { MS_PER_MINUTE } from '../../src/core/units';
import { claimWindow, precisionBounds } from '../../src/core/window';
import { priorSpendCents } from '../../src/core/scope';

const SAMPLE_EVERY = 50;

/** §4.1 candidates by brute force over every observation (no index, no buckets, no memo). */
function bruteCandidates(
  claim: Claim,
  observations: readonly Observation[],
  evaluatedMs: number,
): Observation[] {
  const window = claimWindow(claim, DEFAULT_POLICY);
  if (window === null || !isAssignable(claim, DEFAULT_POLICY)) return [];
  const firstSeenFrom =
    claim.type === 'calendar.created'
      ? precisionBounds(claim).startMs - DEFAULT_POLICY.windows.beforeClaimMin * MS_PER_MINUTE
      : Number.NEGATIVE_INFINITY;
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    const t = Date.parse(o.occurredAt);
    if (o.type !== claim.type || t < window.fromMs || t > window.toMs) continue;
    if (Date.parse(o.observedAt) > evaluatedMs) continue;
    groups.set(o.contentHash, [...(groups.get(o.contentHash) ?? []), o]);
  }
  return [...groups.values()]
    .filter((group) => Math.min(...group.map((o) => Date.parse(o.observedAt))) >= firstSeenFrom)
    .map((group) => [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0])
    .filter((o): o is Observation => o !== undefined);
}

/** Every 50th claim's receipt, recomputed with grade() from brute-force candidates and the batch's evidence. */
function checkSample(workload: GradingWorkload, receipts: readonly Receipt[]): void {
  const evaluatedMs = Date.parse(workload.coverage.evaluatedAt);
  const held = new Map<string, string>();
  for (const r of receipts)
    for (const id of r.observationIds) if (r.claimId !== undefined) held.set(id, r.claimId);
  const byClaim = new Map(receipts.map((r) => [r.claimId, r]));
  workload.claims.forEach((claim, i) => {
    if (i % SAMPLE_EVERY !== 0) return;
    const own = bruteCandidates(claim, workload.observations, evaluatedMs).filter(
      (o) => (held.get(o.id) ?? claim.id) === claim.id,
    );
    const grant = workload.grants.find((g) => g.agent === claim.agent);
    if (grant === undefined) throw new Error('no grant');
    const context = { priorSpendCents: priorSpendCents(claim, workload.activity.claims, DEFAULT_POLICY) };
    const direct = grade(claim, own, grant, DEFAULT_POLICY, workload.coverage, context);
    expect(canonicalJson(byClaim.get(claim.id)), `claim ${String(i)}`).toBe(canonicalJson(direct));
  });
}

describe('perf gate (task 1.5): gradeBatch over 5,000 claims × 50,000 observations', () => {
  it(`grades the whole batch in a median < ${String(GATE_MS)} ms of CPU over ${String(RUNS)} fresh runs, and is right`, async () => {
    const measured = await measure(
      () => {
        const workload = buildGradingWorkload();
        return { workload, index: createMemoryIndex(workload.observations, BUCKET_MINUTES) };
      },
      async ({ workload, index }) => ({ workload, receipts: await gradeAll(workload, index) }),
    );
    console.log(describeRuns(`gradeBatch for ${String(CLAIM_COUNT)} claims`, measured));

    for (const { result } of measured.runs) {
      const { workload, receipts } = result;
      expect(workload.observations).toHaveLength(OBSERVATION_COUNT);
      expect(workload.claims).toHaveLength(CLAIM_COUNT);
      const claimReceipts = receipts.filter((r) => r.claimId !== undefined);
      expect(new Set(claimReceipts.map((r) => r.claimId)).size).toBe(CLAIM_COUNT);
      const evidence = claimReceipts.flatMap((r) => r.observationIds);
      expect(new Set(evidence).size).toBe(evidence.length);
      const count = (grade: Receipt['grade']) => receipts.filter((r) => r.grade === grade).length;
      expect(count('VERIFIED')).toBeGreaterThan(CLAIM_COUNT / 10);
      expect(count('NOT_FOUND')).toBeGreaterThan(CLAIM_COUNT / 10);
      expect(count('UNASKED')).toBeGreaterThan(0);
    }
    const first = measured.runs[0]?.result;
    if (first === undefined) throw new Error('no run');
    checkSample(first.workload, first.receipts);
    // Every run graded identical inputs, so their receipts must be identical (no memo carried a result over).
    const canonical = measured.runs.map((r) => canonicalJson(r.result.receipts));
    expect(new Set(canonical).size).toBe(1);

    expect(measured.medianCpuMs).toBeLessThan(GATE_MS);
  }, 600_000);
});
