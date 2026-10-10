/**
 * The red team's bench (sprint_6 6.0; agents/red_team.md; Hard Rule 12): every strategy under
 * extension/tests/fixtures/attacks/ run through the real pipeline (the extension built from this tree, Attest's readers
 * on each case's pages, the side panel's paste, grading: extension/tests/e2e/support/redteam-case.ts), and one row per
 * strategy: its cases, how many the attack won, the rate, the worst severity, and the grades Attest gave. `pnpm bench`
 * runs it with the others and writes bench/results/redteam-<date>.json; `pnpm redteam` runs it alone (`--only redteam`).
 * An attack that works is reported, never hidden (sprint_6: publish the losses), so this bench has no gate of its own:
 * the sprint's gate reads its rows, and docs/attacks-that-work.md reports them.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAttackCase } from '../extension/tests/e2e/support/redteam-case';
import { loadAttacks } from '../extension/tests/redteam/attack-schema';
import { type CaseRunner, type RedteamReport, runRedteam } from '../extension/tests/redteam/harness';
import type { StrategyRow } from '../extension/tests/redteam/outcome';
import { startFixtureServer } from '../extension/tests/tools/serve-fixtures';
import type { MetricValue } from './results';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.join(BENCH_DIR, '../extension');
/** Where the strategies are, one folder each. */
export const ATTACKS_DIR = path.join(EXTENSION_DIR, 'tests/fixtures/attacks');

/** A strategy's metric prefix, its number and name: "redteam01ClaimInflation". */
export function prefixOf(row: Pick<StrategyRow, 'number' | 'strategy'>): string {
  const words = row.strategy.split('-').map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return `redteam${String(row.number).padStart(2, '0')}${words.join('')}`;
}

/** The report as bench metrics: three counts, then six per strategy. */
export function reportMetrics(rows: readonly StrategyRow[]): Record<string, MetricValue> {
  const metrics: Record<string, MetricValue> = {
    redteamStrategies: rows.length,
    redteamCases: rows.reduce((total, row) => total + row.cases, 0),
    redteamWorking: rows.filter((row) => row.outcome === 'works').length,
  };
  for (const row of rows) {
    const prefix = prefixOf(row);
    metrics[`${prefix}Cases`] = row.cases;
    metrics[`${prefix}Works`] = row.works;
    metrics[`${prefix}Rate`] = row.rate;
    metrics[`${prefix}Severity`] = row.severity;
    metrics[`${prefix}Outcome`] = row.outcome;
    metrics[`${prefix}Grades`] = row.grades;
  }
  return metrics;
}

/** Each case that worked, a line per way it worked: what the founder reads to triage (agents/red_team.md rule 5). */
export function caseLines(report: RedteamReport): string[] {
  return report.cases.flatMap((result) =>
    result.violations.map(
      (violation) => `redteam ${result.strategy}/${result.id}: ${violation.severity}: ${violation.problem}`,
    ),
  );
}

/** The browser runner: the extension built from this tree and the fixture server up, for the length of `use`. */
async function withBrowser<T>(use: (runCase: CaseRunner) => Promise<T>): Promise<T> {
  execFileSync('pnpm', ['build'], { cwd: EXTENSION_DIR, stdio: 'ignore' });
  const server = await startFixtureServer();
  try {
    return await use((strategy, attackCase) => runAttackCase(strategy, attackCase, server.origin));
  } finally {
    await server.close();
  }
}

/**
 * Runs every strategy in `dir` (header). A `runCase` given replaces the browser (the harness's own tests); with no
 * strategy, nothing is built or launched.
 */
export async function runRedteamBench(
  dir: string = ATTACKS_DIR,
  runCase?: CaseRunner,
  log: (line: string) => void = (line) => {
    console.log(line);
  },
): Promise<Readonly<Record<string, MetricValue>>> {
  const strategies = loadAttacks(dir);
  const report =
    runCase !== undefined || strategies.length === 0
      ? await runRedteam(strategies, runCase ?? (() => Promise.reject(new Error('no case to run'))))
      : await withBrowser((runner) => runRedteam(strategies, runner));
  for (const line of caseLines(report)) log(line);
  return reportMetrics(report.rows);
}
