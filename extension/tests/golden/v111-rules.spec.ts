/**
 * The contract v1.11 rules in the golden suite (docs/grading.md v1.11): every v1.11 tag has a scenario that really
 * exercises it, every proof is false on a plain exact match and on a broken copy of its own file, and grading changed
 * copies shows what decides each file: the change claim's own type (109), the second bound account (110), and the
 * claim's content (111).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import type { Receipt } from '../../src/core/schema';
import { buildScenario, loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import { runScenario } from './runner';
import { type ExpectedReceipt, type Scenario, type ScenarioClaim } from './scenario-schema';
import { V111_RULES } from './v111-rules';

const FILES = scenarioFiles();
const SCENARIOS: readonly (readonly [string, Scenario])[] = FILES.map((file) => [file, readScenario(file)]);
const BASE_POLICY = PolicyView.parse(defaultPolicyJson);
const policyOf = (file: string): PolicyView => PolicyView.parse(loadScenario(file).policyJson);
const fileOf = (prefix: string): string => FILES.find((name) => name.startsWith(`${prefix}-`)) ?? '';
const scenario = (prefix: string): Scenario => readScenario(fileOf(prefix));

type Change = (s: Scenario) => Scenario;

const withExpect =
  (ref: string, change: Partial<ExpectedReceipt>): Change =>
  (s) => ({ ...s, expect: s.expect.map((e) => (e.ref === ref ? { ...e, ...change } : e)) });

const withClaim =
  (ref: string, change: Partial<ScenarioClaim>): Change =>
  (s) => ({
    ...s,
    input: { ...s.input, claims: s.input.claims.map((c) => (c.ref === ref ? { ...c, ...change } : c)) },
  });

/** Every expectation without `coverage.account_partial`: the cap a union of two accounts' views calls for. */
const withoutAccountPartial: Change = (s) => ({
  ...s,
  expect: s.expect.map((e) => ({
    ...e,
    reasonCodes: e.reasonCodes.filter((code) => code !== 'coverage.account_partial'),
  })),
});

/** The grant binding only `account` to `source` (the file's one grant). */
const boundTo =
  (source: 'gcal.event' | 'gmail.sent', account: string): Change =>
  (s) => ({
    ...s,
    input: {
      ...s.input,
      grants: s.input.grants.map((g) => ({ ...g, accounts: { ...g.accounts, [source]: [account] } })),
    },
  });

const proofOf = (tag: string): ((s: Scenario, policy: PolicyView) => boolean) | undefined =>
  V111_RULES.find(([name]) => name === tag)?.[1];

/** The v1.11 proof `tag` on a (changed) copy of scenario `prefix`, with that scenario's own patched policy. */
function proves(tag: string, prefix: string, change: Change = (s) => s): boolean {
  return proofOf(tag)?.(change(scenario(prefix)), policyOf(fileOf(prefix))) === true;
}

describe('golden coverage: the contract v1.11 rules', () => {
  it.each(V111_RULES)('contract:%s has a scenario that exercises it', (tag, prove) => {
    const files = SCENARIOS.filter(([, s]) => s.covers.includes(`contract:${tag}`));
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.every(([file, s]) => prove(s, policyOf(file)))).toBe(true);
  });

  it.each(V111_RULES)('contract:%s is not proved by a plain exact match', (_, prove) => {
    expect(prove(scenario('01'), BASE_POLICY)).toBe(false);
  });
});

/** One broken copy per v1.11 proof: the file without the very thing the rule is about. */
const MUTATIONS: readonly (readonly [tag: string, prefix: string, change: Change])[] = [
  [
    'calendar_change_unprovable',
    '109',
    withExpect('c1', {
      grade: 'NOT_FOUND',
      ruleId: 'not_found',
      state: 'FINAL',
      reasonCodes: ['match.none'],
    }),
  ],
  ['per_account_coverage', '110', withoutAccountPartial],
  [
    'no_evidence_on_time_alone',
    '111',
    withExpect('c1', { grade: 'PARTIAL', ruleId: 'partial', observationRefs: ['o1'], score: '5175/8638' }),
  ],
];

describe('every v1.11 proof fails on a broken copy of its own file', () => {
  it('covers every v1.11 tag', () => {
    expect(MUTATIONS.map(([tag]) => tag).sort()).toEqual(V111_RULES.map(([tag]) => tag).sort());
  });

  it.each(MUTATIONS)('contract:%s (file %s)', (tag, prefix, change) => {
    expect(proves(tag, prefix)).toBe(true);
    expect(proves(tag, prefix, change)).toBe(false);
  });
});

/** The receipts of a (changed) copy of scenario `prefix`, graded through the core, and the id of a ref. */
async function graded(
  prefix: string,
  change: Change,
): Promise<{ receipts: readonly Receipt[]; id: (ref: string) => string }> {
  const loaded = buildScenario(fileOf(prefix), change(scenario(prefix)));
  const run = await runScenario(loaded);
  const id = (ref: string): string => loaded.observations.get(ref)?.id ?? loaded.claims.get(ref)?.id ?? '';
  return { receipts: run.receipts, id };
}

/** grade, ruleId and state of the receipt of claim `ref`. */
async function outcome(prefix: string, change: Change, ref: string): Promise<readonly unknown[]> {
  const run = await graded(prefix, change);
  const receipt = run.receipts.find((r) => r.claimId === run.id(ref));
  return [receipt?.grade, receipt?.ruleId, receipt?.state, receipt?.observationIds];
}

describe('what decides the v1.11 files (graded, not read)', () => {
  it('109: the same views make a calendar.created claim nothing matches NOT_FOUND, FINAL', async () => {
    const created = withClaim('c1', { type: 'calendar.created', subjectHint: 'Budget sync' });
    expect(await outcome('109', created, 'c1')).toEqual(['NOT_FOUND', 'not_found', 'FINAL', []]);
  });

  it('110: with acct-b alone bound, its own views make c1 and c3 NOT_FOUND, FINAL', async () => {
    expect(await outcome('110', boundTo('gcal.event', 'acct-b'), 'c1')).toEqual([
      'NOT_FOUND',
      'not_found',
      'FINAL',
      [],
    ]);
    expect(await outcome('110', boundTo('gmail.sent', 'acct-a'), 'c3')).toEqual([
      'NOT_FOUND',
      'not_found',
      'FINAL',
      [],
    ]);
  });

  it('111: one shared subject word opens the gate, and c1 takes o1 as PARTIAL evidence', async () => {
    const run = await graded('111', withClaim('c1', { subjectHint: 'Dentist prep' }));
    const c1 = run.receipts.find((r) => r.claimId === run.id('c1'));
    expect([c1?.grade, c1?.state, c1?.observationIds]).toEqual(['PARTIAL', 'FINAL', [run.id('o1')]]);
    expect(run.receipts.some((r) => r.grade === 'UNASKED')).toBe(false);
  });
});
