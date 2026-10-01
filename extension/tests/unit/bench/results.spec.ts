/**
 * bench/results.ts validates every result file before RESULTS.md is generated from it (TECH-15, Hard Rule 12):
 * a malformed file throws with its name instead of rendering garbage.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { latestResults, parseBenchResult, render } from '../../../../bench/results';

const GOOD = {
  bench: 'core-perf',
  date: '2026-10-01',
  command: 'pnpm bench',
  metrics: { gradeMs: 412, gate: true, unit: 'ms' },
};

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('parseBenchResult', () => {
  it('accepts a well-formed result', () => {
    expect(parseBenchResult('core-perf-2026-10-01.json', GOOD)).toEqual(GOOD);
  });

  it.each([
    ['a file name without a date', 'core-perf.json', GOOD, 'file name'],
    ['a bench that is not the file name', 'other-2026-10-01.json', GOOD, 'bench must be'],
    ['a date that is not the file name', 'core-perf-2026-10-02.json', GOOD, 'date must be'],
    ['an empty command', 'core-perf-2026-10-01.json', { ...GOOD, command: ' ' }, 'command'],
    [
      'a missing command',
      'core-perf-2026-10-01.json',
      { bench: 'core-perf', date: '2026-10-01', metrics: {} },
      'fields must be',
    ],
    ['an extra field', 'core-perf-2026-10-01.json', { ...GOOD, notes: 'x' }, 'fields must be'],
    ['no metrics', 'core-perf-2026-10-01.json', { ...GOOD, metrics: {} }, 'metrics must be'],
    ['a NaN-like metric', 'core-perf-2026-10-01.json', { ...GOOD, metrics: { x: null } }, 'metric x'],
    ['an object metric', 'core-perf-2026-10-01.json', { ...GOOD, metrics: { x: { y: 1 } } }, 'metric x'],
    ['an array', 'core-perf-2026-10-01.json', [GOOD], 'not a JSON object'],
  ])('rejects %s, naming the file', (_label, file, value, problem) => {
    expect(() => parseBenchResult(file, value)).toThrow(new RegExp(`bench/results/${file}: .*${problem}`));
  });
});

describe('latestResults', () => {
  it('reads the newest file per bench and throws on a bad one', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'attest-bench-'));
    writeFileSync(
      path.join(dir, 'core-perf-2026-09-30.json'),
      JSON.stringify({ ...GOOD, date: '2026-09-30' }),
    );
    writeFileSync(path.join(dir, 'core-perf-2026-10-01.json'), JSON.stringify(GOOD));
    expect(latestResults(dir)).toEqual([GOOD]);
    expect(render(latestResults(dir))).toContain('| gradeMs | 412 |');
    writeFileSync(path.join(dir, 'gmail-2026-10-01.json'), '{"bench":"gmail"');
    expect(() => latestResults(dir)).toThrow('bench/results/gmail-2026-10-01.json: not valid JSON');
  });
});
