/**
 * `pnpm bench` gates and provenance (QA-R8, TECH-R12, Hard Rule 12):
 * - a bench gate passes on the median CPU time of fresh runs, the statistic the perf gate tests use
 *   (tests/perf/measure.ts), never on wall time, which is still reported;
 * - `pnpm bench` exits non-zero when a gate of a result it just measured failed, after writing the numbers;
 * - every result records the git commit, whether the tree was dirty, and the Node version.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { provenance, UNKNOWN_COMMIT, type Git } from '../../../../bench/provenance';
import { failedGates } from '../../../../bench/results';
import { dirtyRefusal, localDate, runBenches, type Bench } from '../../../../bench/run_bench';
import { median, summarize } from '../../../../bench/timing';

const SHA = 'a'.repeat(40);
const run = (wallMs: number, cpuMs: number) => ({ wallMs, cpuMs, result: null });

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('bench gates use the perf tests’ statistic: the median CPU of fresh runs', () => {
  it('passes on the CPU median even when wall time is far over the gate (a loaded machine)', () => {
    const summary = summarize([run(2_300, 380), run(2_295, 375), run(2_400, 370)], 2_000);
    expect(summary).toEqual({ medianMs: 2_300, minMs: 2_295, maxMs: 2_400, cpuMedianMs: 375, passed: true });
  });

  it('fails on the CPU median even when wall time is under the gate', () => {
    const summary = summarize([run(900, 2_100), run(950, 2_050), run(990, 10)], 2_000);
    expect(summary.medianMs).toBe(950);
    expect(summary.cpuMedianMs).toBe(2_050);
    expect(summary.passed).toBe(false);
  });

  it('bench/core.ts takes each gate from summarize(), and names the CPU median it gates on', () => {
    // Running the core bench here would take minutes, so its source is read instead: every gate flag must be the
    // `passed` of a summarize() over the fresh runs, never a median compared in place (the old wall-clock gate).
    const source = readFileSync(path.resolve(import.meta.dirname, '../../../../bench/core.ts'), 'utf8');
    const gates = [...source.matchAll(/^\s*(\w*[gG]atePassed):\s*([^,\n]+),/gm)].map((m) => [m[1], m[2]]);
    expect(gates).toEqual([
      ['gatePassed', 'lookup.passed'],
      ['gradingGatePassed', 'grading.passed'],
    ]);
    expect(source).toContain('const lookup = summarize(lookups, GATE_MS);');
    expect(source).toContain('const grading = summarize(runs, GATE_MS);');
    expect(source).toContain("gateMetric: 'lookupCpuMedianMs',");
    expect(source).toContain("gradingGateMetric: 'gradingCpuMedianMs',");
  });

  it('takes the median as tests/perf/measure.ts does (the upper middle for an even count) and needs runs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(() => summarize([], 2_000)).toThrow('no runs');
  });
});

describe('failedGates', () => {
  it('lists every gate metric that is not true, and ignores other booleans', () => {
    const result = {
      bench: 'core',
      date: '2026-10-02',
      command: 'pnpm bench',
      metrics: { gatePassed: true, gradingGatePassed: false, lookupGatePassed: 'yes', commitDirty: true },
    };
    expect(failedGates(result)).toEqual(['gradingGatePassed', 'lookupGatePassed']);
    expect(failedGates({ ...result, metrics: { gatePassed: true, gradingGatePassed: true } })).toEqual([]);
  });
});

describe('provenance: commit, dirty flag and Node version', () => {
  const fakeGit =
    (head: string, status: string): Git =>
    (args) =>
      args[0] === 'rev-parse' ? `${head}\n` : status;

  it('records a clean tree, a dirty tree, and the Node version', () => {
    expect(provenance(fakeGit(SHA, ''), 'v22.14.0')).toEqual({
      commit: SHA,
      commitDirty: false,
      node: 'v22.14.0',
    });
    expect(provenance(fakeGit(SHA, ' M extension/src/core/grade.ts\n')).commitDirty).toBe(true);
    expect(provenance(fakeGit(SHA, '')).node).toBe(process.version);
  });

  it('without git, or with a bad answer, the commit is unknown and the tree counts as dirty', () => {
    const missing: Git = () => {
      throw new Error('spawn git ENOENT');
    };
    expect(provenance(missing, 'v22.14.0')).toEqual({
      commit: UNKNOWN_COMMIT,
      commitDirty: true,
      node: 'v22.14.0',
    });
    expect(provenance(fakeGit('not a sha', '')).commit).toBe(UNKNOWN_COMMIT);
  });

  it('asks git for the state of the measured code, not of the bench outputs', () => {
    const calls: (readonly string[])[] = [];
    provenance((args) => {
      calls.push(args);
      return args[0] === 'rev-parse' ? SHA : '';
    });
    expect(calls).toEqual([
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain', '--', '.', ':(exclude)bench/results', ':(exclude)RESULTS.md'],
    ]);
  });
});

function tempRun(log: string[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-bench-gates-'));
  dirs.push(dir);
  const options = {
    resultsDir: dir,
    resultsMd: path.join(dir, 'RESULTS.md'),
    date: '2026-10-02',
    provenance: { commit: SHA, commitDirty: false, node: 'v22.14.0' },
    log: (line: string) => log.push(line),
  };
  return { dir, options };
}

const bench = (gradingGatePassed: boolean): Bench => ({
  name: 'core',
  run: () => Promise.resolve({ gateMs: 2_000, gatePassed: true, gradingGatePassed }),
});

describe('pnpm bench: exit code and result files', () => {
  it('exits 0 when every gate passed, and every result records its provenance', async () => {
    const log: string[] = [];
    const { dir, options } = tempRun(log);
    expect(await runBenches([bench(true)], options)).toBe(0);
    const written = JSON.parse(readFileSync(path.join(dir, 'core-2026-10-02.json'), 'utf8')) as {
      metrics: Record<string, unknown>;
    };
    expect(written.metrics).toMatchObject({ commit: SHA, commitDirty: false, node: 'v22.14.0' });
    expect(readFileSync(options.resultsMd, 'utf8')).toContain(`| commit | ${SHA} |`);
  });

  it('exits 1 when a gate failed, after still writing the result and RESULTS.md', async () => {
    const log: string[] = [];
    const { dir, options } = tempRun(log);
    expect(await runBenches([bench(false)], options)).toBe(1);
    expect(readFileSync(path.join(dir, 'core-2026-10-02.json'), 'utf8')).toContain(
      '"gradingGatePassed": false',
    );
    expect(readFileSync(options.resultsMd, 'utf8')).toContain('| gradingGatePassed | false |');
    expect(log.at(-1)).toBe('pnpm bench: gate failed: core.gradingGatePassed');
  });

  it('dates the result file with the local calendar date', () => {
    expect(localDate(new Date(2026, 9, 2, 23, 59))).toBe('2026-10-02');
  });
});

describe('pnpm bench refuses a tree that differs from its commit (TECH-L2, Hard Rule 12)', () => {
  const at = (commitDirty: boolean) => ({ commit: 'a'.repeat(40), commitDirty, node: 'v22.14.0' });

  it('refuses a dirty tree, measures a clean one, and measures a dirty one only when asked (--dirty)', () => {
    expect(dirtyRefusal(at(true), [])).toMatch(/Commit first/u);
    expect(dirtyRefusal(at(false), [])).toBeNull();
    expect(dirtyRefusal(at(true), ['--dirty'])).toBeNull();
  });
});
