import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { defineConfig } from 'vitest/config';

// WxtVitest swaps `wxt/browser` for an in-memory fake (storage, runtime messaging, alarms) so
// extension modules are unit-testable without Chrome. src/core tests never need it (pure).
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.spec.ts', 'tests/property/**/*.spec.ts', 'tests/golden/**/*.spec.ts'],
    environment: 'node',
    mockReset: true,
    restoreMocks: true,
  },
});
