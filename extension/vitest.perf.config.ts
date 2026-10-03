import { defineConfig } from 'vitest/config';

/**
 * Perf gates only (tests/perf). Serial and in one fork, so no other test competes for CPU while a gate measures:
 * in the parallel unit run, seven workers on four physical cores inflated a gate's CPU time by about 25%.
 */
export const VITEST_PERF_INCLUDE = 'tests/perf/**/*.perf.spec.ts';

export default defineConfig({
  test: {
    include: [VITEST_PERF_INCLUDE],
    environment: 'node',
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    // Print each gate's medians (tests/perf/measure.ts describeRuns) in `pnpm test` and CI output, also when the
    // gate passes: Vitest hides a passing test's console output by default (QA-R8, Hard Rule 12).
    silent: false,
  },
});
