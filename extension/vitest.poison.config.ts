import { configDefaults, defineConfig } from 'vitest/config';

import baseConfig, { CORE_COVERAGE_LINES } from './vitest.config.ts';

/**
 * The poisoned run (FR3-4, Hard Rule 4): every core, golden and property test, with the runtime guard
 * (tests/unit/core/core-poison.ts) installed before each file's src/core modules load and checked after every test
 * (tests/unit/core/core-poison-setup.ts). The guard reads the caller from the stack, so the tests keep their own
 * clocks while every impure call src/core makes, on any path these suites reach, fails the run. Coverage is on and
 * binding: below CORE_COVERAGE_LINES (95%) of src/core's lines run under the guard, the run fails, so the guard
 * cannot pass by running little of src/core. `pnpm test:poison` runs it, and CI runs that.
 */
export const POISON_INCLUDE = [
  'tests/unit/core/**/*.spec.ts',
  'tests/golden/**/*.spec.ts',
  'tests/property/**/*.spec.ts',
];

/** core-poison.spec.ts and core-poison-controls.spec.ts install and check the guard themselves. */
export const POISON_EXCLUDE = ['tests/unit/core/core-poison*.spec.ts'];

export const POISON_SETUP = 'tests/unit/core/core-poison-setup.ts';

/** The runtime check of each test's timeout (FR3-7), as in the main run. */
export const TIMEOUT_SETUP = 'tests/unit/lint/test-timeout-setup.ts';

const base = baseConfig.test ?? {};

export default defineConfig({
  ...baseConfig,
  test: {
    ...base,
    include: POISON_INCLUDE,
    exclude: [...configDefaults.exclude, ...POISON_EXCLUDE],
    setupFiles: [TIMEOUT_SETUP, POISON_SETUP],
    coverage: {
      ...base.coverage,
      provider: 'v8',
      enabled: true,
      include: ['src/core/**/*.ts'],
      reporter: ['text-summary'],
      reportsDirectory: 'coverage/poison',
      thresholds: { lines: CORE_COVERAGE_LINES },
      reportOnFailure: true,
    },
  },
});
