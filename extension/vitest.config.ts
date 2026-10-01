import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.spec.ts', 'tests/property/**/*.spec.ts', 'tests/golden/**/*.spec.ts'],
    environment: 'node',
  },
});
