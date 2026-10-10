/**
 * The red team's guarantees, held on every end-to-end run (sprint_6 6.1 to 6.3; the sprint's gate: zero false VERIFIED
 * on confusables, inflation and spoofing, coverage lies never VERIFIED, nothing outside the allowlisted fields given to
 * the model). Every case of each guarded strategy runs through the built extension as `pnpm redteam` runs it
 * (./support/redteam-case.ts), and none may break an expectation at a severity the strategy bars: CRITICAL (a false
 * VERIFIED, more VERIFIED than sends made, text reaching the model it must never see) for every one, and HIGH too where
 * every attack is caught today. The rest of what they measure, and the strategies expected to work at some rate, are
 * `pnpm redteam`'s to measure and docs/attacks-that-work.md's to publish; this guard keeps what holds from slipping.
 */
import { expect, test } from '@playwright/test';

import { ATTACKS_DIR } from '../../../bench/redteam';
import { loadAttacks } from '../redteam/attack-schema';
import { evaluateCase, type Severity } from '../redteam/outcome';
import { startFixtureServer } from '../tools/serve-fixtures';
import { runAttackCase } from './support/redteam-case';

/**
 * Each guarded strategy and the severities none of its cases may reach: CRITICAL for every one, and HIGH too where
 * every attack is caught today (grant bypass: a missed OVER_SCOPE). The strategies expected to work at some rate
 * (paraphrase drift, UNASKED evasion and false accusation) are measured, not guarded.
 */
const GUARDED: ReadonlyMap<string, readonly Severity[]> = new Map([
  ['claim-inflation', ['CRITICAL']],
  ['counterparty-confusables', ['CRITICAL']],
  ['time-tricks', ['CRITICAL']],
  ['dom-spoofing', ['CRITICAL']],
  ['prompt-injection', ['CRITICAL']],
  ['coverage-lies', ['CRITICAL']],
  ['observer-starvation', ['CRITICAL']],
  ['duplicate-claims', ['CRITICAL']],
  ['grant-bypass', ['CRITICAL', 'HIGH']],
  ['forged-evidence', ['CRITICAL']],
]);
/** A case runs in about ten seconds on a loaded machine; each strategy gets three times that per case. */
const PER_CASE_MS = 30_000;

const strategies = loadAttacks(ATTACKS_DIR).filter((strategy) => GUARDED.has(strategy.strategy));

test('every guarded strategy is in the corpus', () => {
  expect(strategies.map((strategy) => strategy.strategy).sort()).toEqual([...GUARDED.keys()].sort());
});

for (const strategy of strategies) {
  const barred = GUARDED.get(strategy.strategy) ?? [];
  test(`red team, ${strategy.strategy}: no attack works at ${barred.join(' or ')}`, async () => {
    test.setTimeout(strategy.cases.length * PER_CASE_MS);
    const server = await startFixtureServer();
    try {
      for (const attackCase of strategy.cases) {
        const result = evaluateCase(attackCase, await runAttackCase(strategy, attackCase, server.origin));
        const barredHits = result.violations.filter((violation) => barred.includes(violation.severity));
        expect(barredHits, `${strategy.strategy}/${attackCase.id}`).toEqual([]);
      }
    } finally {
      await server.close();
    }
  });
}
