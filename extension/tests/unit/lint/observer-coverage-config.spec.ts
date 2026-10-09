/**
 * Pins the observer coverage run (Sprint 2 close QA-8; qa_tester rule 8: adapters and observers at least 85% of
 * lines): `pnpm test:coverage:observers` measures src/observers over the suites that run the observers, fails below
 * 85% lines, writes its report even when a test fails, and CI runs it. The core gate is pinned beside the other test
 * tooling (tooling-config.spec.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import observerConfig, {
  OBSERVER_COVERAGE_LINES,
  OBSERVER_COVERAGE_SUITES,
} from '../../../vitest.observers.config';

// vitest.config.ts calls WXT's Vitest plugin as it loads, and the plugin then imports WXT's optional `web-ext` peer in
// the background. It is not installed, so on CI's slower coverage run that import's rejection landed while this file
// ran (three unhandled errors failed the step though every test passed). This file reads only the configs, so the
// plugin is stubbed and WXT never loads here.
vi.mock('wxt/testing/vitest-plugin', () => ({ WxtVitest: () => ({ name: 'wxt-vitest-stub' }) }));

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const REPO = path.resolve(EXTENSION, '..');

const readJson = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as { readonly scripts: Readonly<Record<string, string>> };

describe('observer and adapter coverage (qa_tester rule 8: >= 85% of lines; QA-8, Sprint 3 QA GAP 10)', () => {
  it('measures src/observers and src/adapters over the suites that run them, and fails below 85% lines', () => {
    expect(OBSERVER_COVERAGE_LINES).toBe(85);
    expect(observerConfig.test?.include).toEqual(OBSERVER_COVERAGE_SUITES);
    expect(OBSERVER_COVERAGE_SUITES).toEqual(
      expect.arrayContaining(['tests/unit/observers/**/*.spec.ts', 'tests/unit/adapters/**/*.spec.ts']),
    );
    expect(observerConfig.test?.coverage).toMatchObject({
      provider: 'v8',
      enabled: true,
      include: ['src/observers/**/*.ts', 'src/adapters/**/*.ts'],
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
