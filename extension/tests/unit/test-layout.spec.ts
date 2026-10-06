/**
 * Every test file under tests/unit, tests/property and tests/golden is one Vitest runs (TECH-V5): a file named
 * *.test.ts, *.spec.js or *.spec.mts would otherwise be silently skipped.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { VITEST_INCLUDE } from '../../vitest.config';
import { VITEST_PERF_INCLUDE } from '../../vitest.perf.config';

// vitest.config.ts calls WXT's Vitest plugin as it loads, and the plugin then imports WXT's optional `web-ext` peer in
// the background. It is not installed, so on CI's slower coverage run that import's rejection landed while this file
// ran (three unhandled errors failed the step though every test passed). This file reads only the configs, so the
// plugin is stubbed and WXT never loads here.
vi.mock('wxt/testing/vitest-plugin', () => ({ WxtVitest: () => ({ name: 'wxt-vitest-stub' }) }));

const TESTS = path.resolve(import.meta.dirname, '..');
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

function walk(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('vitest test layout', () => {
  it('includes .spec.ts and .spec.tsx under unit, property and golden', () => {
    expect(VITEST_INCLUDE).toBe('tests/{unit,property,golden}/**/*.spec.{ts,tsx}');
  });

  it('perf gates live in tests/perf and run in their own serial pass', () => {
    expect(VITEST_PERF_INCLUDE).toBe('tests/perf/**/*.perf.spec.ts');
    const perf = walk(path.join(TESTS, 'perf')).filter((file) => TEST_FILE.test(file));
    expect(perf.length).toBeGreaterThanOrEqual(2);
    for (const file of perf) expect(path.relative(TESTS, file)).toMatch(/\.perf\.spec\.ts$/);
  });

  it('every test-named file under those folders is a .spec.ts or .spec.tsx', () => {
    const files = ['unit', 'property', 'golden'].flatMap((dir) => walk(path.join(TESTS, dir)));
    const testFiles = files.filter((file) => TEST_FILE.test(file));
    expect(testFiles.length).toBeGreaterThan(40);
    for (const file of testFiles) expect(path.relative(TESTS, file)).toMatch(/\.spec\.tsx?$/);
  });
});
