/**
 * The pattern-table bench (bench/adapters/patterns.ts; sprint_3 3.0 Done-when and the Sprint 3 gate; Hard Rule 12):
 * `pnpm bench` puts each agent's claim-type accuracy on the labelled corpus in RESULTS.md, gated at 90% with no
 * sentence read as an action it is not labelled, and says the corpus is invented.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATTERNS_ACCURACY_GATE, runPatternsBench, scoreTable } from '../../../../bench/adapters/patterns';
import { failedGates } from '../../../../bench/results';
import { BENCHES } from '../../../../bench/run_bench';
import type { ActionType } from '../../../src/core/schema';

const MUSE = path.join(import.meta.dirname, '../../fixtures/patterns/muse.json');

/** The first sentence of Muse's corpus labelled `type`. */
function museSentence(type: ActionType | null): string {
  const file: unknown = JSON.parse(readFileSync(MUSE, 'utf8'));
  const cases: unknown[] =
    typeof file === 'object' && file !== null && 'cases' in file && Array.isArray(file.cases)
      ? file.cases
      : [];
  for (const entry of cases) {
    if (typeof entry !== 'object' || entry === null || !('text' in entry) || !('type' in entry)) continue;
    if (entry.type === type && typeof entry.text === 'string') return entry.text;
  }
  throw new Error(`Muse's corpus has no sentence labelled ${String(type)}`);
}

describe('the patterns bench', () => {
  it('is registered, and reads every table at the 90% bar with no wrong action, the corpus marked invented', async () => {
    expect(BENCHES.map((bench) => bench.name)).toContain('patterns');
    const metrics = await runPatternsBench();
    for (const agent of ['muse', 'chatgpt', 'dots', 'claude']) {
      expect(metrics[`${agent}TypeAccuracy`]).toBeGreaterThanOrEqual(PATTERNS_ACCURACY_GATE);
      expect(metrics[`${agent}WrongActions`]).toBe(0);
      expect(metrics[`${agent}Sentences`]).toBeGreaterThanOrEqual(40);
    }
    expect(metrics.patternsCorpusInvented).toBe(true);
    const result = { bench: 'patterns', date: '2026-10-09', command: 'pnpm bench', metrics };
    expect(failedGates(result)).toEqual([]);
  });

  it('counts a sentence read as another action as a wrong action, never as right', () => {
    const sent = museSentence('email.sent');
    expect(scoreTable('muse', [{ text: sent, type: 'email.sent' }])).toEqual({ right: 1, wrongActions: 0 });
    expect(scoreTable('muse', [{ text: sent, type: 'purchase.made' }])).toEqual({
      right: 0,
      wrongActions: 1,
    });
    expect(scoreTable('muse', [{ text: sent, type: null }])).toEqual({ right: 0, wrongActions: 1 });
    const none = museSentence(null);
    expect(scoreTable('muse', [{ text: none, type: 'email.sent' }])).toEqual({ right: 0, wrongActions: 0 });
  });
});
