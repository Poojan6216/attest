import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { defineConfig } from 'vitest/config';

/** Every unit, property and golden test. tests/unit/test-layout.spec.ts proves no test file falls outside it. */
export const VITEST_INCLUDE = 'tests/{unit,property,golden}/**/*.spec.{ts,tsx}';

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
  },
});
