/**
 * What each page bundles (Sprint 5 close, tech review TECH-1; Decisions [4.0]: pages read the ledger, the service
 * worker is its one writer). Walked from each page's entry through every import, static or dynamic, re-exports
 * included and type-only imports left out (they bundle nothing): no page reaches src/background, and the ledger
 * modules of writers it reaches are exactly those below, each through a reader it uses. The lint fence
 * (eslint-rules/fences.js PAGE_RESTRICTED_IMPORTS) holds what a page's own files import, so no page calls a writer;
 * this holds what those files import in turn, which a rule on one file cannot see. Sprint 5 had let the telemetry
 * preview bring src/ledger/repo.ts and upsert.ts back to the options page, and the export the Calendar store: both are
 * gone, and any new reach fails here.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const PAGES = ['popup', 'sidepanel', 'options', 'digest'] as const;

/** The ledger's modules of writers (fences.js PAGE_RESTRICTED_IMPORTS) and the service worker's code. */
const WRITER_MODULES =
  /^src\/(background\/.+|ledger\/(repo|upsert|grant-save|user-events|retention|retention-clock|retention-coverage|replay-records|coverage|calendar-snapshots|activity|clock-guard|clock-repairs|clock-high-water|batch-instant|migrations))\.ts$/u;

const STATIC = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'";]*?\bfrom\s+['"]([^'"]+)['"]/gu;
const BARE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/gu;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu;

/** The relative specifiers `source` imports for code (header). */
function specifiers(source: string): string[] {
  return [STATIC, BARE, DYNAMIC].flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ''),
  );
}

/** The source file `spec` names from `from`, or null for a package or a file that is not code. */
function resolved(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  return candidates.find((file) => /\.tsx?$/u.test(file) && existsSync(file)) ?? null;
}

/** Every source file `entry` reaches (header), relative to extension/. */
function reach(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.join(EXTENSION, entry)];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const relative = path.relative(EXTENSION, file);
    if (seen.has(relative)) continue;
    seen.add(relative);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const next = resolved(file, spec);
      if (next !== null) queue.push(next);
    }
  }
  return seen;
}

/**
 * The writer modules a page reaches, each through a reader it uses: the page's connection opens the ledger at the
 * schema's version (shared.ts → migrations.ts); its views read when the last batch ran (views.ts → batch-instant.ts
 * `lastBatchMs`); a receipt's detail reads its inputs (detail.ts → replay-records.ts `receiptInputsOf`); the digest and
 * the usage numbers read coverage windows (coverage-store.ts, whose writers note the stored instant: clock-high-water.ts).
 */
const COMMON = ['src/ledger/batch-instant.ts', 'src/ledger/migrations.ts', 'src/ledger/replay-records.ts'];
const WITH_COVERAGE = [...COMMON, 'src/ledger/clock-high-water.ts'].sort();
const REACHED: Readonly<Record<(typeof PAGES)[number], readonly string[]>> = {
  popup: COMMON,
  sidepanel: COMMON,
  options: WITH_COVERAGE,
  digest: WITH_COVERAGE,
};

describe('what each page bundles', () => {
  it.each(PAGES)('%s reaches no service-worker code, and only the ledger writers listed', (page) => {
    const files = reach(`entrypoints/${page}/main.tsx`);
    expect(files.size).toBeGreaterThan(20);
    expect([...files].filter((file) => WRITER_MODULES.test(file)).sort()).toEqual(REACHED[page]);
  });

  it('sees through a chain: the walk finds what a page reaches two imports away', () => {
    const files = reach('entrypoints/options/main.tsx');
    // options → telemetry preview → the builder → its schema.
    expect(files).toContain('src/telemetry/schema.ts');
  });
});
