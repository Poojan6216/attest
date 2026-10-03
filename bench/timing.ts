/**
 * Timing for the benches, and how a gate is decided from it (QA-R8, TECH-R12, Hard Rule 12).
 *
 * A gate passes on the same statistic as the perf gate tests (extension/tests/perf/measure.ts, Decisions [1.perf]):
 * the median CPU time (user + system, `process.cpuUsage`) of runs on freshly built workloads. Wall time is still
 * measured and reported beside it (median, min, max), so no number is hidden, but it never decides a gate: on a
 * loaded machine the same workload has shown a 2.3 s wall median at 375 ms of CPU.
 */
const MICROSECONDS_PER_MS = 1_000;

export interface Timed<T> {
  readonly wallMs: number;
  readonly cpuMs: number;
  readonly result: T;
}

/** Wall and CPU time of `act` (user + system CPU of this process). */
export async function timed<T>(act: () => T | Promise<T>): Promise<Timed<T>> {
  const cpuBefore = process.cpuUsage();
  const startedAt = performance.now();
  const result = await act();
  const wallMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuBefore);
  return { wallMs, cpuMs: (cpu.user + cpu.system) / MICROSECONDS_PER_MS, result };
}

/** The middle value (the upper middle for an even count), as tests/perf/measure.ts computes it. NaN when empty. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Milliseconds to one decimal place, for the result file. */
export const round = (ms: number): number => Math.round(ms * 10) / 10;

export interface GateSummary {
  /** Wall-clock median, min and max (reported, never gated on). */
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** The gated statistic: the median CPU time of the runs. */
  readonly cpuMedianMs: number;
  /** Whether the (unrounded) CPU median is under the gate, exactly as the perf gate test decides it. */
  readonly passed: boolean;
}

/** Summarises fresh runs of one operation against a gate. Throws on no runs: an unmeasured number is no number. */
export function summarize(runs: readonly Timed<unknown>[], gateMs: number): GateSummary {
  if (runs.length === 0) throw new Error('bench: no runs to summarise');
  const walls = runs.map((run) => run.wallMs);
  const cpuMedian = median(runs.map((run) => run.cpuMs));
  return {
    medianMs: round(median(walls)),
    minMs: round(Math.min(...walls)),
    maxMs: round(Math.max(...walls)),
    cpuMedianMs: round(cpuMedian),
    passed: cpuMedian < gateMs,
  };
}
