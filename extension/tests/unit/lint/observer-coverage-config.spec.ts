/**
 * Pins the observer coverage run (Sprint 2 close QA-8; qa_tester rule 8: adapters and observers at least 85% of
 * lines): `pnpm test:coverage:observers` measures src/observers over the suites that run the observers, fails below
 * 85% lines, writes its report even when a test fails, and CI runs it. The core gate is pinned beside the other test
 * tooling (tooling-config.spec.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import observerConfig, {
  OBSERVER_COVERAGE_LINES,
  OBSERVER_COVERAGE_SUITES,
} from '../../../vitest.observers.config';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const REPO = path.resolve(EXTENSION, '..');

const readJson = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as { readonly scripts: Readonly<Record<string, string>> };

describe('observer coverage (qa_tester rule 8: observers >= 85% of lines; QA-8)', () => {
  it('measures src/observers over the suites that run them, and fails below 85% lines', () => {
    expect(OBSERVER_COVERAGE_LINES).toBe(85);
    expect(observerConfig.test?.include).toEqual(OBSERVER_COVERAGE_SUITES);
    expect(OBSERVER_COVERAGE_SUITES).toEqual(expect.arrayContaining(['tests/unit/observers/**/*.spec.ts']));
    expect(observerConfig.test?.coverage).toMatchObject({
      provider: 'v8',
      enabled: true,
      include: ['src/observers/**/*.ts'],
      thresholds: { lines: OBSERVER_COVERAGE_LINES },
      reportOnFailure: true,
    });
  });

  it('has a test:coverage:observers script in both package.json files, and CI runs it', () => {
    expect(readJson(path.join(EXTENSION, 'package.json')).scripts['test:coverage:observers']).toBe(
      'vitest run --config vitest.observers.config.ts',
    );
    expect(readJson(path.join(REPO, 'package.json')).scripts['test:coverage:observers']).toBe(
      'pnpm --dir extension run test:coverage:observers',
    );
    const ci = readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('      - name: Observer coverage\n        run: pnpm test:coverage:observers\n');
  });
});
