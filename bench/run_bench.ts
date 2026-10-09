/**
 * `pnpm bench` — the one command that produces RESULTS.md (Hard Rule 12).
 *
 * Runs the registered benches. Each bench returns its metrics; this script adds where they were measured (the git
 * commit, whether the tree was dirty, the Node version: bench/provenance.ts), validates the result and writes it to
 * bench/results/<name>-<yyyy-mm-dd>.json, then regenerates RESULTS.md from the newest result file of each bench
 * (bench/results.ts). RESULTS.md is generated, never hand-edited. The exit code is 1 when any gate of a result
 * measured in this run failed (QA-R8): the numbers are still written, and the command still fails.
 *
 * A tree that differs from its commit is refused (tech review TECH-L2): numbers measured on uncommitted code would
 * cite a commit that does not hold that code, and could not be reproduced from it (Hard Rule 12). Commit, then run
 * the bench, then commit its results. `--dirty` measures anyway, for a look while working; such results say
 * `commitDirty: true` and are not committed.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runPasteBench } from './adapters/paste';
import { runPatternsBench } from './adapters/patterns';
import { runCoreBench } from './core';
import { runGcalBench } from './observers/gcal';
import { runGmailBench } from './observers/gmail';
import { runReceiptsBench } from './observers/receipts';
import { runUiBench } from './ui';
import { gitIn, type Provenance, provenance } from './provenance';
import { failedGates, latestResults, parseBenchResult, render, type MetricValue } from './results';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(BENCH_DIR, '..');

export interface Bench {
  readonly name: string;
  run(): Promise<Readonly<Record<string, MetricValue>>>;
}

export interface BenchRunOptions {
  /** Where result files are written and read from. */
  readonly resultsDir: string;
  /** The RESULTS.md to regenerate. */
  readonly resultsMd: string;
  /** The date in the result file names (yyyy-mm-dd). */
  readonly date: string;
  /** Metrics every result carries about where it was measured (commit, commitDirty, node). */
  readonly provenance: Readonly<Record<string, MetricValue>>;
  readonly log: (line: string) => void;
}

/** Benches register here as later sprints add them (core perf, observers, adapters, intel, red team). */
export const BENCHES: readonly Bench[] = [
  { name: 'core', run: runCoreBench },
  { name: 'gmail-sent', run: runGmailBench },
  { name: 'receipts', run: runReceiptsBench },
  { name: 'gcal', run: runGcalBench },
  { name: 'patterns', run: runPatternsBench },
  { name: 'paste', run: runPasteBench },
  { name: 'ui', run: runUiBench },
];

/** The calendar date of `now` in the machine's own time zone (the bench may read the clock; core may not). */
export function localDate(now: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** Runs `benches`, writes their results and RESULTS.md, and returns the exit code: 0, or 1 when a gate failed. */
export async function runBenches(benches: readonly Bench[], options: BenchRunOptions): Promise<number> {
  const failed: string[] = [];
  for (const bench of benches) {
    const fileName = `${bench.name}-${options.date}.json`;
    const metrics = { ...(await bench.run()), ...options.provenance };
    const result = parseBenchResult(fileName, {
      bench: bench.name,
      date: options.date,
      command: 'pnpm bench',
      metrics,
    });
    writeFileSync(path.join(options.resultsDir, fileName), `${JSON.stringify(result, null, 2)}\n`);
    const gates = failedGates(result);
    failed.push(...gates.map((gate) => `${bench.name}.${gate}`));
    options.log(
      `${bench.name}: ${gates.length === 0 ? 'every gate passed' : `FAILED ${gates.join(', ')}`} → ${fileName}`,
    );
  }
  writeFileSync(options.resultsMd, render(latestResults(options.resultsDir)));
  options.log(`RESULTS.md regenerated (${String(benches.length)} benches registered).`);
  if (failed.length === 0) return 0;
  options.log(`pnpm bench: gate failed: ${failed.join(', ')}`);
  return 1;
}

/** Why a run must not write results (a tree that differs from its commit, without `--dirty`), or null. */
export function dirtyRefusal(measured: Provenance, argv: readonly string[]): string | null {
  if (!measured.commitDirty || argv.includes('--dirty')) return null;
  return 'pnpm bench: the tree differs from its commit, so these numbers could not be reproduced from it. Commit first (or pass --dirty for a look that is not committed).';
}

const invokedAs = process.argv[1];
if (invokedAs !== undefined && import.meta.url === pathToFileURL(path.resolve(invokedAs)).href) {
  const measured = provenance(gitIn(REPO_ROOT));
  const refusal = dirtyRefusal(measured, process.argv.slice(2));
  if (refusal !== null) {
    console.log(refusal);
    process.exitCode = 1;
  } else {
    process.exitCode = await runBenches(BENCHES, {
      resultsDir: path.join(BENCH_DIR, 'results'),
      resultsMd: path.join(REPO_ROOT, 'RESULTS.md'),
      date: localDate(new Date()),
      provenance: { ...measured },
      log: (line) => {
        console.log(line);
      },
    });
  }
}
