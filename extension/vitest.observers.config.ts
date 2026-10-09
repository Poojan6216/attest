import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config.ts';

/**
 * Observer and adapter coverage (qa_tester rule 8: adapters and observers at least 85% of lines; Sprint 2 close QA-8,
 * Sprint 3 QA review GAP 10). The suites that run them (their own unit tests, the bus tests that start them, and the
 * labelled fixture tests), instrumented over src/observers and src/adapters (the paste parser among them), failing
 * below OBSERVER_COVERAGE_LINES. `pnpm test:coverage:observers` runs it, and CI runs that, so a drop no longer goes
 * unnoticed.
 */
export const OBSERVER_COVERAGE_LINES = 85;

export const OBSERVER_COVERAGE_SUITES = [
  'tests/unit/observers/**/*.spec.ts',
  'tests/unit/adapters/**/*.spec.ts',
  'tests/unit/bus/**/*.spec.ts',
  'tests/unit/fixtures/**/*.spec.ts',
  'tests/property/**/{calendar,gcal,observer}*.property.spec.ts',
];

const base = baseConfig.test ?? {};

export default defineConfig({
  ...baseConfig,
  test: {
    ...base,
    include: OBSERVER_COVERAGE_SUITES,
    coverage: {
      ...base.coverage,
      provider: 'v8',
      enabled: true,
      include: ['src/observers/**/*.ts', 'src/adapters/**/*.ts'],
      reporter: ['text-summary'],
      reportsDirectory: 'coverage/observers',
      thresholds: { lines: OBSERVER_COVERAGE_LINES },
      reportOnFailure: true,
    },
  },
});
