/**
 * The contract v1.14 rule in the golden suite (docs/grading.md v1.14): its tag has a scenario that really exercises
 * it, its proof is false on a plain exact match and on broken copies of its own file, and grading a copy shows what
 * the rule decides: with the early Sent view counted as settled, as v1.13 counted it, the reply the list had not
 * shown yet is NOT_FOUND (Hard Rule 5).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import type { Receipt } from '../../src/core/schema';
import { buildScenario, loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import { runScenario } from './runner';
import { type Scenario } from './scenario-schema';
import { V114_RULES } from './v114-rules';

const FILES = scenarioFiles();
const SCENARIOS: readonly (readonly [string, Scenario])[] = FILES.map((file) => [file, readScenario(file)]);
const BASE_POLICY = PolicyView.parse(defaultPolicyJson);
const policyOf = (file: string): PolicyView => PolicyView.parse(loadScenario(file).policyJson);
const fileOf = (prefix: string): string => FILES.find((name) => name.startsWith(`${prefix}-`)) ?? '';
const scenario = (prefix: string): Scenario => readScenario(fileOf(prefix));

type Change = (s: Scenario) => Scenario;

/** The early Sent view re-stamped as synced at evaluatedAt: settled for every claim, as v1.13 treated it. */
const settledEarly: Change = (s) => ({
  ...s,
  input: {
    ...s.input,
    coverage: s.input.coverage.map((e, at) => (at === 0 ? { ...e, lastSyncAt: s.input.evaluatedAt } : e)),
  },
});

/** The file's expectation for c1 replaced by what v1.13 said: NOT_FOUND, FINAL. */
const v113Expectation: Change = (s) => ({
  ...s,
  expect: s.expect.map((e) =>
    e.ref === 'c1'
      ? {
          ...e,
          grade: 'NOT_FOUND',
          ruleId: 'not_found',
          state: 'FINAL',
          reasonCodes: ['match.none'],
          reasonParams: undefined,
        }
      : e,
  ),
});

const proofOf = (tag: string) => V114_RULES.find(([name]) => name === tag)?.[1];

function proves(tag: string, prefix: string, change: Change = (s) => s): boolean {
  return proofOf(tag)?.(change(scenario(prefix)), policyOf(fileOf(prefix))) === true;
}

describe('golden coverage: the contract v1.14 rule', () => {
  it.each(V114_RULES)('contract:%s has a scenario that exercises it', (tag, prove) => {
    const files = SCENARIOS.filter(([, s]) => s.covers.includes(`contract:${tag}`));
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.every(([file, s]) => prove(s, policyOf(file)))).toBe(true);
  });

  it.each(V114_RULES)('contract:%s is not proved by a plain exact match', (_, prove) => {
    expect(prove(scenario('01'), BASE_POLICY)).toBe(false);
  });
});

const MUTATIONS: readonly (readonly [tag: string, prefix: string, change: Change])[] = [
  ['sent_list_unsettled_capped', '113', settledEarly],
  ['sent_list_unsettled_capped', '113', v113Expectation],
];

describe('every v1.14 proof fails on a broken copy of its own file', () => {
  it('covers every v1.14 tag', () => {
    expect([...new Set(MUTATIONS.map(([tag]) => tag))].sort()).toEqual(V114_RULES.map(([tag]) => tag).sort());
  });

  it.each(MUTATIONS)('contract:%s (file %s)', (tag, prefix, change) => {
    expect(proves(tag, prefix)).toBe(true);
    expect(proves(tag, prefix, change)).toBe(false);
  });
});

async function graded(
  prefix: string,
  change: Change,
): Promise<{ receipts: readonly Receipt[]; id: (ref: string) => string }> {
  const loaded = buildScenario(fileOf(prefix), change(scenario(prefix)));
  const run = await runScenario(loaded);
  const id = (ref: string): string => loaded.observations.get(ref)?.id ?? loaded.claims.get(ref)?.id ?? '';
  return { receipts: run.receipts, id };
}

describe('what decides the v1.14 file (graded, not read)', () => {
  it('113: with the early Sent view settled, the reply the list had not shown yet is NOT_FOUND', async () => {
    const kept = await graded('113', (s) => s);
    const keptClaim = kept.receipts.find((r) => r.claimId === kept.id('c1'));
    expect([keptClaim?.grade, keptClaim?.state]).toEqual(['UNVERIFIABLE', 'PENDING']);
    const broken = await graded('113', settledEarly);
    const claim = broken.receipts.find((r) => r.claimId === broken.id('c1'));
    expect([claim?.grade, claim?.state]).toEqual(['NOT_FOUND', 'FINAL']);
  });
});
