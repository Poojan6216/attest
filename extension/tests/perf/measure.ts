/**
 * How a perf gate measures (qa_tester rule 7; Decisions [1.perf]): the operation runs RUNS times, each on a
 * freshly built workload (new objects, so no WeakMap memo carries a result from one run into the next), in a
 * process where no other test file runs (vitest.perf.config.ts: serial, one fork). The gated number is the
 * median CPU time (user + system, `process.cpuUsage`) of the runs: the first run is cold (V8 compiles the code,
 * partly on background threads that count as CPU), the rest are warm, as the service worker is when it grades
 * again and again. Every run's CPU and wall time is logged, cold run included, so no number is hidden.
 *
 * A run is charged only for its own work: each run's correctness checks run after its timer stops (`settle`),
 * and only what they return (a digest) is kept, so the run's workload and receipts are garbage before the next
 * run builds its own. Keeping every earlier run's data alive made the second run pay a full major GC for data
 * the product never holds (Decisions [1.close] QA-R3). The workload, the runs and the gate are unchanged.
 */
export const RUNS = 3;
const MICROSECONDS_PER_MS = 1_000;

export interface Run<T> {
  readonly cpuMs: number;
  readonly wallMs: number;
  readonly result: T;
}

export interface Measured<T> {
  readonly runs: readonly Run<T>[];
  readonly medianCpuMs: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/**
 * Runs `act` on `build()`'s fresh input RUNS times and reports every run plus the median CPU. `settle` checks a
 * run's result after its timer stops and returns what the caller keeps; the input and the full result are then
 * dropped, so no run marks an earlier run's data.
 */
export async function measure<W, T, S = T>(
  build: () => W,
  act: (input: W) => T | Promise<T>,
  settle: (input: W, result: T) => S,
): Promise<Measured<S>> {
  const runs: Run<S>[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    runs.push(await timedRun(build, act, settle));
  }
  return { runs, medianCpuMs: median(runs.map((r) => r.cpuMs)) };
}

/** One run: build, time `act`, then settle outside the timed region. Nothing but the settled value escapes. */
async function timedRun<W, T, S>(
  build: () => W,
  act: (input: W) => T | Promise<T>,
  settle: (input: W, result: T) => S,
): Promise<Run<S>> {
  const input = build();
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  const result = await act(input);
  const wallMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuBefore);
  return { cpuMs: (cpu.user + cpu.system) / MICROSECONDS_PER_MS, wallMs, result: settle(input, result) };
}

export function describeRuns(label: string, measured: Measured<unknown>): string {
  const each = measured.runs.map(
    (r, i) => `run ${String(i + 1)} ${r.cpuMs.toFixed(1)} ms CPU / ${r.wallMs.toFixed(1)} ms wall`,
  );
  return `perf gate: ${label}: median ${measured.medianCpuMs.toFixed(1)} ms CPU (${each.join('; ')})`;
}
