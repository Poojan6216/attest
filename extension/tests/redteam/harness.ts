/**
 * The red-team harness (sprint_6 6.0; agents/red_team.md): every case of every strategy run, one at a time (`runCase`:
 * in the bench, the built extension in a browser of its own, ../e2e/support/redteam-case.ts), judged on the ledger it
 * left (./outcome.ts), and gathered into one row per strategy. An empty attacks folder gives an empty report.
 */
import type { AttackCase, Strategy } from './attack-schema';
import { type CaseResult, evaluateCase, type JudgedLedger, type StrategyRow, strategyRow } from './outcome';

/** Runs one case and returns the ledger it left (in the bench, its export). */
export type CaseRunner = (strategy: Strategy, attackCase: AttackCase) => Promise<JudgedLedger>;

export interface StrategyCaseResult extends CaseResult {
  readonly strategy: string;
}

export interface RedteamReport {
  /** One row per strategy, by number. */
  readonly rows: readonly StrategyRow[];
  /** Every case's result, under its strategy's name. */
  readonly cases: readonly StrategyCaseResult[];
}

export async function runRedteam(
  strategies: readonly Strategy[],
  runCase: CaseRunner,
): Promise<RedteamReport> {
  const rows: StrategyRow[] = [];
  const cases: StrategyCaseResult[] = [];
  for (const strategy of strategies) {
    const results: CaseResult[] = [];
    for (const attackCase of strategy.cases) {
      results.push(evaluateCase(attackCase, await runCase(strategy, attackCase)));
    }
    rows.push(strategyRow(strategy, results));
    cases.push(...results.map((result) => ({ ...result, strategy: strategy.strategy })));
  }
  return { rows, cases };
}
