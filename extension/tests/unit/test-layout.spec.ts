/**
 * Every test file under tests/unit, tests/property and tests/golden is one Vitest runs (TECH-V5): a file named
 * *.test.ts, *.spec.js or *.spec.mts would otherwise be silently skipped.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { VITEST_INCLUDE } from '../../vitest.config';

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

  it('every test-named file under those folders is a .spec.ts or .spec.tsx', () => {
    const files = ['unit', 'property', 'golden'].flatMap((dir) => walk(path.join(TESTS, dir)));
    const testFiles = files.filter((file) => TEST_FILE.test(file));
    expect(testFiles.length).toBeGreaterThan(40);
    for (const file of testFiles) expect(path.relative(TESTS, file)).toMatch(/\.spec\.tsx?$/);
  });
});
