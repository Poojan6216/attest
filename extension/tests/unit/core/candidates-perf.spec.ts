/**
 * Perf gate, sprint 1 task 1.3 (qa_tester rule 7: a perf gate is a test, not a note; ledger_engineer rule 9):
 * candidate lookup for 5,000 claims over 50,000 observations must take under 2,000 ms in Node. The workload is
 * the bench's own (bench/core.ts: seeded mulberry32, no Math.random), so the committed bench number and this
 * gate measure the same thing. If this fails, fix the index, not the gate.
 *
 * The clock is this process's CPU time (user + system, `process.cpuUsage`) over the lookup, not wall time.
 * The lookup is synchronous, single-threaded work (core is pure; the memory index resolves at once), so on an
 * idle machine the two agree. Inside a parallel suite on a busy machine, wall time measures the scheduler
 * instead: measured at 2.9–3.3 s wall for 0.38–0.46 s of CPU. CPU time also counts V8's GC and compiler
 * threads, which only makes the gate stricter. Wall time is logged beside it, and bench/core.ts commits the
 * wall-clock median of runs made alone. Code that really is slow (a full scan) fails either way.
 *
 * A fast wrong answer must not pass: every 25th claim is checked against a brute-force scan of every
 * observation, and the lookup must return a substantial number of candidates (no vacuous fast path).
 */
import { describe, expect, it } from 'vitest';

import {
  buildCoreWorkload,
  buildIndex,
  CLAIM_COUNT,
  GATE_MS,
  lookupAll,
  OBSERVATION_COUNT,
} from '../../../../bench/core';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { Observation } from '../../../src/core/schema';
import { MS_PER_MINUTE } from '../../../src/core/units';
import { claimWindow, precisionBounds, type WindowClaim } from '../../../src/core/window';

/** Every SAMPLE_EVERY-th claim is re-derived by brute force. */
const SAMPLE_EVERY = 25;
const MICROSECONDS_PER_MS = 1_000;

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
  it(`candidate lookup for every claim takes < ${String(GATE_MS)} ms of CPU, and is right`, async () => {
    const workload = buildCoreWorkload();
    expect(workload.observations).toHaveLength(OBSERVATION_COUNT);
    expect(workload.claims).toHaveLength(CLAIM_COUNT);
    const index = buildIndex(workload);

    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    const results = await lookupAll(workload, index);
    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    const cpuMs = (cpu.user + cpu.system) / MICROSECONDS_PER_MS;

    console.log(
      `perf gate: candidate lookup for ${String(CLAIM_COUNT)} claims took ${cpuMs.toFixed(1)} ms CPU (${wallMs.toFixed(1)} ms wall)`,
    );
    expect(cpuMs).toBeLessThan(GATE_MS);

    expect(results).toHaveLength(CLAIM_COUNT);
    const total = results.reduce((sum, list) => sum + list.length, 0);
    expect(total).toBeGreaterThan(CLAIM_COUNT * 10);
    const parsed = workload.observations.map((o) => ({ o, t: Date.parse(o.occurredAt) }));
    workload.claims.forEach((claim, i) => {
      if (i % SAMPLE_EVERY !== 0) return;
      expect(results[i]?.map((o) => o.id)).toEqual(bruteForce(claim, parsed));
    });
  }, 120_000);
});
