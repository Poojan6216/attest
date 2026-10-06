/**
 * One suite-wide test timeout (vitest.config.ts TEST_TIMEOUT_MS, 60 s; TECH-R3). No unit, property or golden test
 * restates or shortens it: a timeout at or under 60 s is noise at best, and at worst a load-dependent failure with
 * no defect (qa_tester rule 10). A test that needs longer says so itself, with a literal or a file constant above
 * 60 s (the 120 s, 300 s and 600 s properties). Hooks keep their own timeouts: Vitest's hookTimeout is separate.
 * The scan reads a timeout however it is written (PI-8): positional, `{ timeout: … }`, shorthand `{ timeout }`, a
 * spread of a file-level options object, and the suite-wide bound itself, `vi.setConfig({ testTimeout })` or any
 * `testTimeout` property. A value it cannot read (an imported constant, a spread of anything but a file-level object
 * literal) counts as offending.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { TEST_TIMEOUT_MS } from '../../../vitest.config';
import { checkTimeout, SUITE_TIMEOUT_MS } from './test-timeout-setup';
import { offending, specFiles, TESTS, timeoutsIn } from './test-timeouts-scan';

// vitest.config.ts calls WXT's Vitest plugin as it loads, and the plugin then imports WXT's optional `web-ext` peer in
// the background. It is not installed, so on CI's slower coverage run that import's rejection landed while this file
// ran (three unhandled errors failed the step though every test passed). This file reads only the configs, so the
// plugin is stubbed and WXT never loads here.
vi.mock('wxt/testing/vitest-plugin', () => ({ WxtVitest: () => ({ name: 'wxt-vitest-stub' }) }));

describe('test timeouts: one suite-wide bound (TECH-R3)', () => {
  const files = ['unit', 'property', 'golden'].flatMap((dir) => specFiles(path.join(TESTS, dir)));
  const all = files.flatMap((file) => timeoutsIn(path.relative(TESTS, file), readFileSync(file, 'utf8')));

  it('no unit, property or golden test sets a timeout of 60 s or less', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(offending(all)).toEqual([]);
  });

  it('the longer ones are still read: the 600 s replay properties', () => {
    const replay = all.filter(({ where }) => where.startsWith(path.join('property', 'replay.property')));
    expect(replay.length).toBeGreaterThan(0);
    for (const { ms } of replay) expect(ms).toBe(600_000);
  });
});

describe('test timeouts: the scanner reads every spelling (negative controls)', () => {
  it('the scanner sees a timeout however it is written', () => {
    const probe = [
      'const SHORT = 30_000;',
      'const LONG = 5 * 120_000;',
      'const DYNAMIC = Number(process.env.T);',
      "const OPTIONS = { tags: ['gate'], timeout: 10_000 };",
      "it('a', () => {}, 60_000);",
      "it('b', () => {}, SHORT);",
      "test('c', { timeout: 5_000 }, () => {});",
      "describe.each([1])('d %s', () => {}, 1000);",
      "it.skip('e', async () => {}, 600_000);",
      "it('f', () => {}, LONG);",
      "it('g', () => {}, DYNAMIC);",
      "describe('h', OPTIONS, () => {});",
      "it('i', () => { setTimeout(() => {}, 10); });",
    ].join('\n');
    expect(offending(timeoutsIn('probe.spec.ts', probe))).toEqual([
      'probe.spec.ts:5 60_000',
      'probe.spec.ts:6 SHORT',
      'probe.spec.ts:7 5_000',
      'probe.spec.ts:8 1000',
      'probe.spec.ts:11 DYNAMIC',
      'probe.spec.ts:4 10_000',
    ]);
  });
});

/** Every other way to write a timeout (PI-8): shorthand, spreads, quoted and computed keys, the suite-wide bound. */
const SPELLINGS = [
  'const timeout = 1_000;',
  'const OPTS = { timeout: 2_000 };',
  'const LONG = { timeout: 600_000 };',
  "const GATE = { tags: ['gate'] };",
  "it('shorthand', { timeout }, () => {});",
  "it('spread', { ...OPTS }, () => {});",
  "it('spread imported', { ...IMPORTED }, () => {});",
  'vi.setConfig({ testTimeout: 1_000 });',
  'vitest.setConfig(CONFIG);',
  'vi.setConfig({ ...SHARED });',
  'const testTimeout = 5_000;',
  'vi.setConfig({ testTimeout });',
  "it('long', { ...LONG }, () => {});",
  "describe('gate', { ...GATE }, () => {});",
  'vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_000 });',
  "it('quoted', { 'timeout': 3_000 }, () => {});",
  "it('computed', { ['timeout']: 4_000 }, () => {});",
  "it('computed key', { [KEY]: 600_000 }, () => {});",
  "vi.setConfig({ ['testTimeout']: 5_000 });",
  "const config = { 'testTimeout': 6_000 };",
].join('\n');

/** What the scanner must report in SPELLINGS: every value at or under 60 s, and every one it cannot read. */
const SPELLINGS_OFFENDING = [
  'probe.spec.ts:5 timeout',
  'probe.spec.ts:2 2_000',
  'probe.spec.ts:7 IMPORTED',
  'probe.spec.ts:8 1_000',
  'probe.spec.ts:9 CONFIG',
  'probe.spec.ts:10 SHARED',
  'probe.spec.ts:12 testTimeout',
  'probe.spec.ts:16 3_000',
  'probe.spec.ts:17 4_000',
  'probe.spec.ts:18 KEY',
  'probe.spec.ts:19 5_000',
  'probe.spec.ts:20 6_000',
];

describe('test timeouts: shorthand, spreads and the suite-wide bound (PI-8)', () => {
  it('the scanner sees shorthand, spread options and the suite-wide bound set from a test file', () => {
    expect(offending(timeoutsIn('probe.spec.ts', SPELLINGS))).toEqual(SPELLINGS_OFFENDING);
  });
});

/** The forms the third verification found (FR3-7): each test there ran with a 1 s timeout the scan did not read. */
const ROUND_THREE = [
  'const LONG = 120_000;',
  "describe('d', () => {",
  '  const LONG = 1_000;',
  "  it('shadowed constant', () => {}, LONG);",
  '});',
  'let MUTABLE = 120_000;',
  'MUTABLE = 1_000;',
  "it('let, reassigned', () => {}, MUTABLE);",
  'const OPTS = { timeout: 120_000 };',
  'OPTS.timeout = 1_000;',
  "it('mutated options', OPTS, () => {});",
  'const t = it;',
  "t('aliased it', () => {}, 1_000);",
  "test.extend({})('extended test', () => {}, 1_000);",
  'const myTest = test.extend({});',
  "myTest('extended, named', () => {}, 1_000);",
  "suite('s', () => {}, 1_000);",
  "const CONFIG = { ['test' + 'Timeout']: 1_000 };",
  'vi.setConfig(CONFIG);',
].join('\n');

describe('test timeouts: aliases, suites, written constants and computed keys (FR3-7)', () => {
  it('the scanner reports each form the third verification found', () => {
    expect(offending(timeoutsIn('probe.spec.ts', ROUND_THREE))).toEqual([
      'probe.spec.ts:4 LONG',
      'probe.spec.ts:8 MUTABLE',
      'probe.spec.ts:11 OPTS',
      'probe.spec.ts:13 1_000',
      'probe.spec.ts:14 1_000',
      'probe.spec.ts:16 1_000',
      'probe.spec.ts:17 1_000',
      "probe.spec.ts:18 'test' + 'Timeout'",
    ]);
  });

  it('control: a file-level constant declared once and never written is still read', () => {
    const code = [
      'const LONG = 120_000;',
      "const GATE = { tags: ['gate'], timeout: 300_000 };",
      "it('a', () => {}, LONG);",
      "describe('b', GATE, () => {});",
      "it.each([1])('c %s', () => {}, LONG);",
    ].join('\n');
    expect(timeoutsIn('probe.spec.ts', code).map(({ ms }) => ms)).toEqual([120_000, 300_000, 120_000]);
  });

  it('every test runs with at least the suite-wide timeout, read from the test itself (the setup file)', ({
    task,
  }) => {
    expect(SUITE_TIMEOUT_MS).toBe(TEST_TIMEOUT_MS);
    expect(task.timeout).toBeGreaterThanOrEqual(TEST_TIMEOUT_MS);
    expect(() => {
      checkTimeout({ name: 'short', timeout: 1_000 });
    }).toThrow(/short: runs with a 1000 ms timeout/);
    expect(() => {
      checkTimeout({ name: 'restated', timeout: TEST_TIMEOUT_MS });
    }).not.toThrow();
    expect(() => {
      checkTimeout({ name: 'long', timeout: 600_000 });
    }).not.toThrow();
  });
});
