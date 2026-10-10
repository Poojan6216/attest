import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config.ts';

/**
 * UI coverage (qa_tester rule 8: the UI at least 70% of lines; sprint_4 close, QA review GAP 14). The suites that render
 * the shared components and the four pages, and read what they show, instrumented over src/ui and the pages'
 * entrypoints (popup, side panel, options, digest; the dev components page ships nothing and is left out), failing
 * below UI_COVERAGE_LINES. `pnpm test:coverage:ui` runs it, and CI runs that, as it runs the observers' gate.
 */
export const UI_COVERAGE_LINES = 70;

export const UI_COVERAGE_SUITES = [
  'tests/unit/ui/**/*.spec.ts',
  'tests/unit/popup/**/*.spec.ts',
  'tests/unit/sidepanel/**/*.spec.ts',
  'tests/unit/options/**/*.spec.ts',
  'tests/unit/digest/**/*.spec.ts',
  'tests/unit/copy.spec.ts',
];

const base = baseConfig.test ?? {};

export default defineConfig({
  ...baseConfig,
  test: {
    ...base,
    include: UI_COVERAGE_SUITES,
    coverage: {
      ...base.coverage,
      provider: 'v8',
      enabled: true,
      include: ['src/ui/**/*.{ts,tsx}', 'entrypoints/{popup,sidepanel,options,digest}/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'text'],
      reportsDirectory: 'coverage/ui',
      thresholds: { lines: UI_COVERAGE_LINES },
      reportOnFailure: true,
    },
  },
});
