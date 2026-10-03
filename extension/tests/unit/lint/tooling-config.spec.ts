/**
 * Pins the test tooling the Sprint 1 close settled (QA-R1, QA-G2, QA-VG1, TECH-R3, QA-R4, TECH-R2, QA-R8):
 * - one suite-wide timeout of 60 s, so no heavy property or lint test falls back to Vitest's 5 s default and fails
 *   under load with no defect (a timeout guards a hang, it is not an assertion), and no retries anywhere;
 * - `pnpm test:coverage` measures src/core only and fails below 95% lines (the Gate), writing its report even
 *   when a test fails, and CI runs it;
 * - the perf pass prints each gate's medians, also when the gate passes;
 * - the `gate` tag exists and the Sprint 1 grep test over src/core carries it (TECH-R1, QA-R7).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import vitestConfig, { CORE_COVERAGE_LINES, TEST_TIMEOUT_MS } from '../../../vitest.config';
import perfConfig from '../../../vitest.perf.config';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const REPO = path.resolve(EXTENSION, '..');

const readJson = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as { scripts: Record<string, string> };

describe('vitest.config.ts: timeouts and retries', () => {
  it('sets one suite-wide test timeout of 60 s', () => {
    expect(TEST_TIMEOUT_MS).toBe(60_000);
    expect(vitestConfig.test?.testTimeout).toBe(TEST_TIMEOUT_MS);
  });

  it('never retries a failing test, in either pass', () => {
    expect(vitestConfig.test?.retry ?? 0).toBe(0);
    expect(perfConfig.test?.retry ?? 0).toBe(0);
  });

  it('declares the gate tag, and the Sprint 1 grep test over src/core carries it (TECH-R1, QA-R7)', () => {
    expect(vitestConfig.test?.tags?.map((tag) => tag.name)).toContain('gate');
    const purity = readFileSync(path.join(EXTENSION, 'tests/unit/core/core-purity.spec.ts'), 'utf8');
    expect(purity).toContain("const GATE = { tags: ['gate'] };");
    expect(purity).toMatch(/describe\('src\/core purity on the real files[^']*', GATE, /);
  });
});

describe('core coverage (the Gate: core coverage >= 95%)', () => {
  it('measures src/core with v8, fails below 95% lines, and reports even when a test fails', () => {
    expect(CORE_COVERAGE_LINES).toBe(95);
    expect(vitestConfig.test?.coverage).toMatchObject({
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      thresholds: { lines: CORE_COVERAGE_LINES },
      reportOnFailure: true,
    });
  });

  it('has a test:coverage script in both package.json files, and CI runs it', () => {
    expect(readJson(path.join(EXTENSION, 'package.json')).scripts['test:coverage']).toBe(
      'vitest run --coverage',
    );
    expect(readJson(path.join(REPO, 'package.json')).scripts['test:coverage']).toBe(
      'pnpm --dir extension run test:coverage',
    );
    const ci = readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('      - name: Core coverage\n        run: pnpm test:coverage\n');
  });
});

describe('vitest.perf.config.ts: the medians are printed', () => {
  it('keeps the console output of a passing gate', () => {
    expect(perfConfig.test?.silent).toBe(false);
  });
});
