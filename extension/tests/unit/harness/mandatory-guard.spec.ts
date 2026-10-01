/**
 * Guards the two @mandatory tests (sprint 0 header: "No sprint after this one may merge with either test
 * red, skipped, or weakened"; task 0.5: "wired so Sprint 2+ cannot skip it"). Added by the Sprint 0 QA
 * review and hardened when Sprint 0 closed (QA-V1): a skipped Playwright test does not fail a run, so
 *  - the source of both specs and every module they import is checked for any way of skipping;
 *  - the real Playwright config is checked for anything that filters tests;
 *  - Playwright itself lists exactly the pinned tests under `--grep @mandatory`;
 *  - the CI step is pinned byte for byte, and CI checks its JSON report (tests/tools/check-mandatory-report.ts).
 * Changing anything pinned here is a reviewed decision: update this file and log it in Decisions.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../../../playwright.config';
import { checkMandatoryReport, MANDATORY_TESTS } from '../../tools/mandatory-report';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const E2E = path.join(EXTENSION, 'tests/e2e');
const read = (file: string): string => readFileSync(file, 'utf8');

/** Any way of turning a Playwright test off, conditionally or not, at load time or at run time. */
const SKIP_PATTERNS = [
  /\.(?:skip|fixme|fail|only)\s*\(/,
  /\.(?:skip|fixme|fail|only)\b(?!\w)/,
  /\btest\.describe\.configure\(/,
  /\bretries\s*:/,
];

/** The spec and every relative module it imports, transitively. */
function moduleClosure(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of read(file).matchAll(/^import[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      if (spec === undefined) continue;
      const base = path.resolve(path.dirname(file), spec);
      const resolved = [`${base}.ts`, base, path.join(base, 'index.ts')].find(
        (c) => existsSync(c) && c.endsWith('.ts'),
      );
      if (resolved?.startsWith(path.join(EXTENSION, 'tests')) === true) visit(resolved);
    }
  };
  visit(entry);
  return [...seen];
}

describe('the @mandatory tests cannot be skipped or quietly weakened', () => {
  it.each(Object.entries(MANDATORY_TESTS))('%s is tagged, complete, and has no skip', (file, titles) => {
    const source = read(path.join(E2E, file));
    expect(source).toMatch(/test\.describe\([^)]*\{ tag: '@mandatory' \}/);
    for (const title of titles) expect(source, title).toContain(`test('${title}'`);
  });

  it.each(Object.keys(MANDATORY_TESTS))('%s and every module it imports have no way to skip', (file) => {
    const modules = moduleClosure(path.join(E2E, file));
    expect(modules.length).toBeGreaterThan(3);
    for (const module of modules) {
      const source = read(module);
      for (const pattern of SKIP_PATTERNS) {
        expect(source, `${path.relative(EXTENSION, module)} ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('the network session lasts 5 minutes over 3 fixture pages and every extension page', () => {
    const source = read(path.join(E2E, 'network-intercept.spec.ts'));
    expect(source).toContain('const SESSION_MS = 5 * 60_000;');
    expect(source).toContain('const ALLOWLIST: readonly string[] = [];');
    expect(source).toMatch(/FIXTURE_PAGES = \[(?:\s*'[^']+',?){3}\s*\]/);
    expect(source).toContain("const EXTENSION_PAGES = ['popup.html', 'options.html', 'sidepanel.html'];");
    expect(source).toContain('expect(report.violations).toEqual([]);');
    expect(source).toContain('expect(report.unknownBrowserHosts).toEqual([]);');
  });

  it('the no-leak test searches every channel and asserts none leaked', () => {
    const source = read(path.join(E2E, 'no-leak.spec.ts'));
    for (const channel of [
      'ledger-export',
      'indexeddb',
      'chrome-storage',
      'web-storage',
      'cache-storage',
      'page-storage',
      'cookies',
      'console',
      'network',
    ]) {
      expect(source, channel).toMatch(new RegExp(`findLeaks\\(\\s*'${channel}'`));
    }
    expect(source).toContain('expect(leaks).toEqual([]);');
  });

  it('the Playwright config never retries and filters nothing', () => {
    expect(config.retries).toBe(0);
    expect(config.testDir).toBe('tests/e2e');
    expect(config.testMatch).toBe('**/*.spec.ts');
    for (const key of [
      'testIgnore',
      'grep',
      'grepInvert',
      'projects',
      'shard',
      'globalSetup',
      'tag',
    ] as const) {
      expect(config, key).not.toHaveProperty(key);
    }
  });

  it('Playwright collects exactly the pinned tests under --grep @mandatory', () => {
    const cli = path.join(EXTENSION, 'node_modules/@playwright/test/cli.js');
    const out = execFileSync(
      process.execPath,
      [cli, 'test', '--list', '--grep', '@mandatory', '--reporter=json'],
      {
        cwd: EXTENSION,
        env: { ...process.env, CI: '' },
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    expect(checkMandatoryReport(JSON.parse(out), 'list')).toEqual([]);
  }, 60_000);

  it('the run-mode check fails a report with a skipped, failed, retried or missing mandatory test', () => {
    const passed = { status: 'expected', results: [{ status: 'passed', retry: 0 }] };
    const report = (tests: Record<string, unknown>) => ({
      suites: Object.entries(MANDATORY_TESTS).map(([file, titles]) => ({
        specs: titles.map((title) => ({ title, file, tests: [tests[title] ?? passed] })),
      })),
    });
    expect(checkMandatoryReport(report({}), 'run')).toEqual([]);
    const [first, second] = MANDATORY_TESTS['no-leak.spec.ts'] ?? [];
    if (first === undefined || second === undefined) throw new Error('pinned titles missing');
    const bad = report({
      [first]: { status: 'skipped', results: [] },
      [second]: {
        status: 'flaky',
        results: [
          { status: 'failed', retry: 0 },
          { status: 'passed', retry: 1 },
        ],
      },
    });
    expect(checkMandatoryReport(bad, 'run')).toHaveLength(4);
    expect(checkMandatoryReport({ suites: [] }, 'run')).toHaveLength(5);
  });

  it('CI runs the mandatory step exactly as pinned, unconditionally, then checks its report', () => {
    const ci = read(path.join(EXTENSION, '../.github/workflows/ci.yml'));
    expect(ci).toContain(
      [
        '      - name: E2E (@mandatory)',
        '        run: pnpm --dir extension exec playwright test --grep @mandatory --reporter=list,json',
        '        env:',
        "          CI: 'true'",
        '          PLAYWRIGHT_JSON_OUTPUT_FILE: mandatory-report.json',
        '',
        '      - name: Check every @mandatory test ran and passed',
        '        run: pnpm --dir extension exec tsx tests/tools/check-mandatory-report.ts mandatory-report.json',
        '',
      ].join('\n'),
    );
    expect(ci).not.toMatch(/continue-on-error/);
    // Every `if:` in the workflow belongs to an upload step, never to a test step.
    for (const [condition] of ci.matchAll(/^ {8}if: .*$/gm))
      expect(condition).toMatch(/always\(\)|failure\(\)/);
    const ifSteps = [...ci.matchAll(/- name: ([^\n]+)\n {8}if:/g)].map((m) => m[1]);
    expect(ifSteps.every((name) => name?.startsWith('Upload'))).toBe(true);
  });
});
