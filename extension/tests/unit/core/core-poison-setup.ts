/**
 * Setup file of the poisoned run (vitest.poison.config.ts; FR3-1, FR3-3, FR3-4, Hard Rule 4). Vitest evaluates it
 * before each test file, so the guard (./core-poison.ts) is installed, armed, before any src/core module that file
 * imports is evaluated: a built-in src/core captures or calls while it loads is the guard's twin, and a use made then
 * is recorded. The built-ins are snapshotted right after (./core-poison-intrinsics.ts). After every test, and once
 * more after the file, no impure use may have been recorded (a `catch` in src/core cannot hide one) and no built-in
 * may have changed. The whole of tests/unit/core, tests/golden and tests/property runs this way; the guard reads the
 * caller from the stack, so test code keeps its own clock while every call src/core makes is checked.
 */
import { afterAll, afterEach, expect } from 'vitest';

import { installPoison, POISONED_GLOBALS } from './core-poison';
import { intrinsicChanges, snapshotIntrinsics } from './core-poison-intrinsics';

/**
 * Installed armed. It notes no pure uses (this run asserts only that nothing impure happened) and lets `Date.parse` of
 * an ISO timestamp with an offset through as pure (see PoisonOptions): both would otherwise read the stack on every
 * such call the harness makes.
 */
const poison = installPoison({ witness: false, offsetParse: true });
const BUILT_INS = snapshotIntrinsics(POISONED_GLOBALS);

/** Fails the current test (or the file) when src/core made an impure use or changed a built-in. */
function expectPure(when: string): void {
  expect(poison.violations, `${when}: impure uses made by src/core`).toEqual([]);
  expect(intrinsicChanges(BUILT_INS), `${when}: built-ins changed`).toEqual([]);
}

afterEach(() => {
  expectPure('after the test');
});

afterAll(() => {
  try {
    expectPure('after the file');
  } finally {
    poison.restore();
  }
});
