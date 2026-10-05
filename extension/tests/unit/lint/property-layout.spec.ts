/**
 * Every property suite lives under tests/property (build_spec §6 test layout; Sprint 2 close TECH-15). Six Sprint 2
 * property suites had been added under tests/unit, where test-layout.spec.ts (names only) let them be, and where they
 * missed the test:tz runs in other time zones. A file named `*.property.spec.ts` or `*-property.spec.ts` anywhere
 * else under tests/ fails here.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const TESTS = path.resolve(import.meta.dirname, '../..');

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : specFiles(full);
    return /\.spec\.tsx?$/.test(entry.name) ? [path.relative(TESTS, full)] : [];
  });
}

const PROPERTY_SUITE = /[.-]property\.spec\.tsx?$/;

describe('property suites live under tests/property (TECH-15)', () => {
  it('no property suite sits anywhere else', () => {
    const suites = specFiles(TESTS).filter((file) => PROPERTY_SUITE.test(path.basename(file)));
    expect(suites.length).toBeGreaterThan(30);
    expect(suites.filter((file) => !file.startsWith(`property${path.sep}`))).toEqual([]);
  });
});
