/**
 * The red team's guarantees, held on every end-to-end run (sprint_6 6.1, 6.2; the sprint's gate: zero false VERIFIED
 * on confusables, inflation and spoofing, coverage lies never VERIFIED, nothing outside the allowlisted fields given to
 * the model). Every case of each guarded strategy runs through the built extension as `pnpm redteam` runs it
 * (./support/redteam-case.ts), and none may break an expectation at CRITICAL severity: a false VERIFIED, more VERIFIED
 * than sends made, or text reaching the model it must never see. What else they measure, and the strategies whose
 * attacks are expected to work at some rate (paraphrase drift), are `pnpm redteam`'s to measure and
 * docs/attacks-that-work.md's to publish; this guard keeps what holds from slipping unseen.
 */
import { expect, test } from '@playwright/test';

import { ATTACKS_DIR } from '../../../bench/redteam';
import { loadAttacks } from '../redteam/attack-schema';
import { evaluateCase } from '../redteam/outcome';
import { startFixtureServer } from '../tools/serve-fixtures';
import { runAttackCase } from './support/redteam-case';

/** The strategies with a CRITICAL guarantee; paraphrase drift allows VERIFIED, so nothing in it can be CRITICAL. */
const GUARDED: ReadonlySet<string> = new Set([
  'claim-inflation',
  'counterparty-confusables',
  'time-tricks',
  'dom-spoofing',
  'prompt-injection',
  'coverage-lies',
  'forged-evidence',
]);
/** A case runs in about ten seconds on a loaded machine; each strategy gets three times that per case. */
const PER_CASE_MS = 30_000;

const strategies = loadAttacks(ATTACKS_DIR).filter((strategy) => GUARDED.has(strategy.strategy));

test('every guarded strategy is in the corpus', () => {
  expect(strategies.map((strategy) => strategy.strategy).sort()).toEqual([...GUARDED].sort());
});

for (const strategy of strategies) {
  test(`red team, ${strategy.strategy}: no attack works at CRITICAL`, async () => {
    test.setTimeout(strategy.cases.length * PER_CASE_MS);
    const server = await startFixtureServer();
    try {
      for (const attackCase of strategy.cases) {
        const result = evaluateCase(attackCase, await runAttackCase(strategy, attackCase, server.origin));
        const critical = result.violations.filter((violation) => violation.severity === 'CRITICAL');
        expect(critical, `${strategy.strategy}/${attackCase.id}`).toEqual([]);
      }
    } finally {
      await server.close();
    }
  });
}
