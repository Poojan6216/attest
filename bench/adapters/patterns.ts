/**
 * Claim-type accuracy of the pattern tables (sprint_3 3.0 Done-when and the Sprint 3 gate; agents/adapter_engineer.md
 * rule 9; src/adapters/patterns.ts; Hard Rule 12). Each agent's table is run over its vendor's labelled corpus and the
 * shared one (extension/tests/fixtures/patterns/<vendor>.json; Dots reads with ChatGPT's table and corpus), exactly as
 * the sentences of a pasted activity log are typed (src/adapters/paste.ts reads each entry with the same `classify`):
 *  - `<agent>TypeAccuracy`: the share of sentences typed as labelled (an action, `other`, or no claim at all);
 *  - `<agent>WrongActions`: sentences typed as an action they are not labelled. A miss may lose a claim or make it
 *    `other`, never a wrong action that could end in a NOT_FOUND against the agent (Hard Rule 5), so this must be 0;
 *  - the gate (`patternsGatePassed`): every table at least `PATTERNS_ACCURACY_GATE` with no wrong action.
 * Corpus honesty: every sentence is invented, since no vendor's page may be read (Decisions [3.10]). The numbers say
 * how the tables read sentences written the way the vendors' logs are written, not how they read real logs
 * (`patternsCorpusInvented`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classify } from '../../extension/src/adapters/patterns';
import { ActionType, type AgentId } from '../../extension/src/core/schema';
import type { MetricValue } from '../results';

/** The bar of sprint_3 3.0 and the Sprint 3 gate: claim-type accuracy on the labelled corpus. */
export const PATTERNS_ACCURACY_GATE = 0.9;

const CORPUS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../extension/tests/fixtures/patterns',
);

/** One labelled sentence: the type it must be read as, or null for no claim. */
interface Case {
  readonly text: string;
  readonly type: ActionType | null;
}

const LABEL = ActionType.nullable();

/** A vendor's corpus file, as tests/unit/adapters/patterns.spec.ts reads it; anything else fails the bench loudly. */
function corpus(name: string): Case[] {
  const file: unknown = JSON.parse(readFileSync(path.join(CORPUS_DIR, `${name}.json`), 'utf8'));
  if (typeof file !== 'object' || file === null || !('cases' in file) || !Array.isArray(file.cases)) {
    throw new Error(`patterns bench: ${name}.json holds no cases`);
  }
  const entries: unknown[] = file.cases;
  return entries.map((entry) => {
    if (typeof entry !== 'object' || entry === null || !('text' in entry) || !('type' in entry)) {
      throw new Error(`patterns bench: ${name}.json holds a case without text and type`);
    }
    if (typeof entry.text !== 'string' || entry.text === '') {
      throw new Error(`patterns bench: ${name}.json holds a case with no text`);
    }
    return { text: entry.text, type: LABEL.parse(entry.type) };
  });
}

/** Each agent and the corpus of its vendor. */
const TABLES: readonly (readonly [AgentId, string])[] = [
  ['muse', 'muse'],
  ['chatgpt', 'chatgpt'],
  ['dots', 'chatgpt'],
  ['claude', 'claude'],
];

/** One table over its cases: how many were typed as labelled, and how many as an action they are not. */
export function scoreTable(agent: AgentId, cases: readonly Case[]): { right: number; wrongActions: number } {
  let right = 0;
  let wrongActions = 0;
  for (const { text, type } of cases) {
    const typed = classify(agent, text)?.type ?? null;
    if (typed === type) right += 1;
    else if (typed !== null && typed !== 'other') wrongActions += 1;
  }
  return { right, wrongActions };
}

export function runPatternsBench(): Promise<Readonly<Record<string, MetricValue>>> {
  const shared = corpus('shared');
  const metrics: Record<string, MetricValue> = {};
  let passed = true;
  for (const [agent, name] of TABLES) {
    const cases = [...corpus(name), ...shared];
    const { right, wrongActions } = scoreTable(agent, cases);
    const accuracy = right / cases.length;
    metrics[`${agent}Sentences`] = cases.length;
    metrics[`${agent}TypeAccuracy`] = Math.round(accuracy * 10_000) / 10_000;
    metrics[`${agent}WrongActions`] = wrongActions;
    passed = passed && accuracy >= PATTERNS_ACCURACY_GATE && wrongActions === 0;
  }
  metrics.patternsAccuracyThreshold = PATTERNS_ACCURACY_GATE;
  metrics.patternsCorpusInvented = true;
  metrics.patternsGatePassed = passed;
  return Promise.resolve(metrics);
}
