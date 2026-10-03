/**
 * The suite-wide test timeout, checked on every test as it runs (FR3-7, TECH-R3): a setup file of the main run
 * (vitest.config.ts) and of the poisoned run (vitest.poison.config.ts). Vitest fixes each test's timeout when it
 * collects the test and runs it with exactly `task.timeout`, so this reads the timeout a test really gets, however
 * it was set: an aliased `it`, `test.extend(…)`, `suite(…, n)`, a shadowed, reassigned or mutated constant, a
 * computed key or `vi.setConfig`. A test that needs longer than the suite-wide bound says so; none may have less.
 * tests/unit/lint/test-timeouts.spec.ts keeps the syntactic scan for a timeout that restates the bound.
 */
import { beforeEach, expect } from 'vitest';

/** vitest.config.ts TEST_TIMEOUT_MS, restated so this file loads nothing else; tooling-config.spec.ts pins both. */
export const SUITE_TIMEOUT_MS = 60_000;

/** Throws when `task` runs with less than the suite-wide timeout. */
export function checkTimeout(task: { readonly name: string; readonly timeout: number }): void {
  expect(task.timeout, `${task.name}: runs with a ${String(task.timeout)} ms timeout`).toBeGreaterThanOrEqual(
    SUITE_TIMEOUT_MS,
  );
}

beforeEach(({ task }) => {
  checkTimeout(task);
});
