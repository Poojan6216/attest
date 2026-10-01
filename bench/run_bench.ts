/**
 * `pnpm bench` — the one command that produces RESULTS.md (Hard Rule 12).
 *
 * Every bench writes a JSON file to bench/results/<name>-<yyyy-mm-dd>.json. This script runs the
 * registered benches, then regenerates RESULTS.md from the newest result file of each bench, each one
 * validated first (bench/results.ts). RESULTS.md is generated, never hand-edited.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { latestResults, render } from './results';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(BENCH_DIR, 'results');
const RESULTS_MD = path.join(BENCH_DIR, '..', 'RESULTS.md');

/** Benches register here as later sprints add them (core perf, observers, adapters, intel, red team). */
const BENCHES: readonly { readonly name: string; run(): Promise<void> }[] = [];

for (const bench of BENCHES) await bench.run();
writeFileSync(RESULTS_MD, render(latestResults(RESULTS_DIR)));
console.log(`RESULTS.md regenerated (${String(BENCHES.length)} benches registered).`);
