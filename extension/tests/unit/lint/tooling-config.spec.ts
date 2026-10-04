/**
 * Pins the test tooling the Sprint 1 close settled (QA-R1, QA-G2, QA-VG1, TECH-R3, QA-R4, TECH-R2, QA-R8):
 * - one suite-wide timeout of 60 s, so no heavy property or lint test falls back to Vitest's 5 s default and fails
 *   under load with no defect (a timeout guards a hang, it is not an assertion), and no retries anywhere;
 * - `pnpm test:coverage` measures src/core only and fails below 95% lines (the Gate), writing its report even
 *   when a test fails, and CI runs it;
 * - the perf pass prints each gate's medians, also when the gate passes;
 * - the `gate` tag exists and the Sprint 1 grep test over src/core carries it (TECH-R1, QA-R7);
 * - every test's timeout is checked as it runs, in both runs (FR3-7);
 * - the poisoned run (FR3-4): every core, golden and property test under the runtime guard, installed before src/core
 *   loads, with a binding 95% line floor on src/core under the guard; `pnpm test:poison` runs it and CI runs that.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import vitestConfig, { CORE_COVERAGE_LINES, TEST_TIMEOUT_MS } from '../../../vitest.config';
import perfConfig from '../../../vitest.perf.config';
import poisonConfig, {
  POISON_EXCLUDE,
  POISON_INCLUDE,
  POISON_INDEX_ALIAS,
  POISON_LEDGER_EXCLUDE,
  POISON_SETUP,
  TIMEOUT_SETUP,
} from '../../../vitest.poison.config';

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

describe('the suite-wide timeout is checked on every test as it runs (FR3-7)', () => {
  it('both runs load the setup file that checks it', () => {
    expect(vitestConfig.test?.setupFiles).toContain(TIMEOUT_SETUP);
    expect(poisonConfig.test?.setupFiles).toContain(TIMEOUT_SETUP);
  });
});

describe('the poisoned run (FR3-4): core, golden and property tests under the runtime guard', () => {
  it("runs every core, golden and property test but the guard's own specs, with the guard set up first", () => {
    expect(POISON_INCLUDE).toEqual([
      'tests/unit/core/**/*.spec.ts',
      'tests/golden/**/*.spec.ts',
      'tests/property/**/*.spec.ts',
    ]);
    expect(POISON_EXCLUDE).toEqual(['tests/unit/core/core-poison*.spec.ts']);
    expect(poisonConfig.test?.include).toEqual(POISON_INCLUDE);
    expect(poisonConfig.test?.exclude).toEqual(expect.arrayContaining(POISON_EXCLUDE));
    // Only the ledger's own index property leaves the guarded run, and the candidate tests swap to the memory index
    // there (it does no I/O); the main run keeps both implementations.
    expect(POISON_LEDGER_EXCLUDE).toEqual(['tests/property/candidates-ledger-index.property.spec.ts']);
    expect(poisonConfig.test?.exclude).toEqual(expect.arrayContaining(POISON_LEDGER_EXCLUDE));
    expect(POISON_INDEX_ALIAS).toBe('tests/unit/ledger/index-implementations-memory.ts');
    expect(poisonConfig.test?.setupFiles).toEqual([TIMEOUT_SETUP, POISON_SETUP]);
    expect(poisonConfig.test?.testTimeout).toBe(TEST_TIMEOUT_MS);
    expect(poisonConfig.test?.retry ?? 0).toBe(0);
  });

  it('measures src/core under the guard and fails below 95% lines', () => {
    expect(poisonConfig.test?.coverage).toMatchObject({
      provider: 'v8',
      enabled: true,
      include: ['src/core/**/*.ts'],
      thresholds: { lines: CORE_COVERAGE_LINES },
      reportOnFailure: true,
    });
  });

  it('has a test:poison script in both package.json files, and CI runs it', () => {
    expect(readJson(path.join(EXTENSION, 'package.json')).scripts['test:poison']).toBe(
      'vitest run --config vitest.poison.config.ts',
    );
    expect(readJson(path.join(REPO, 'package.json')).scripts['test:poison']).toBe(
      'pnpm --dir extension run test:poison',
    );
    const ci = readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('      - name: Core under the runtime guard\n        run: pnpm test:poison\n');
  });
});
