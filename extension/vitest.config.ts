import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { defineConfig } from 'vitest/config';

/** Every unit, property and golden test. tests/unit/test-layout.spec.ts proves no test file falls outside it. */
export const VITEST_INCLUDE = 'tests/{unit,property,golden}/**/*.spec.{ts,tsx}';

/**
 * One upper bound for every test (QA-R1, QA-G2, QA-VG1, TECH-R3). A timeout guards against a hang; it is not an
 * assertion, so raising Vitest's 5 s default weakens nothing. Under machine load (and v8 coverage) the heavy
 * property, lint and policy tests went over 5 s with no defect, which turned `pnpm test`, test:tz and the coverage
 * run red (qa_tester rule 10: flaky = failing). A test that needs longer still says so itself (the 300 s and
 * 600 s properties). Never add retries: a failure must fail.
 */
export const TEST_TIMEOUT_MS = 60_000;

/**
 * Coverage of src/core only, the Gate's "core coverage >= 95%" (sprint_1.md; QA-R4, TECH-R2): `pnpm test:coverage`
 * runs the whole suite instrumented, prints lines, branches, functions and statements for src/core, and fails
 * when lines drop below 95%. The report is written even when a test fails, so the number is never lost.
 */
export const CORE_COVERAGE_LINES = 95;

/**
 * Test tags (Vitest rejects an undeclared one). `gate` marks the tests a sprint Gate cites by name, such as the
 * Sprint 1 grep test over src/core (tests/unit/core/core-purity.spec.ts): `vitest run --tags-filter gate`.
 */
export const TEST_TAGS = [
  { name: 'gate', description: 'A test a sprint Gate cites (sprints/sprint_<N>.md, Gate line).' },
];

// WxtVitest swaps `wxt/browser` for an in-memory fake (storage, runtime messaging, alarms) so
// extension modules are unit-testable without Chrome. src/core tests never need it (pure).
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // .tsx too: a Preact component test written as *.spec.tsx must never be silently skipped (TECH-V5).
    include: [VITEST_INCLUDE],
    environment: 'node',
    mockReset: true,
    restoreMocks: true,
    testTimeout: TEST_TIMEOUT_MS,
    tags: TEST_TAGS,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: CORE_COVERAGE_LINES },
      reportOnFailure: true,
    },
  },
});
