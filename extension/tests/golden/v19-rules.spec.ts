/**
 * The contract v1.9 rules in the golden suite (docs/grading.md v1.9): every v1.9 tag has a scenario that really
 * exercises it, every proof is false on a plain exact match and on a broken copy of its own file.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import { type ExpectedReceipt, type Scenario, type ScenarioObservation } from './scenario-schema';
import { V19_RULES } from './v19-rules';

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

const withObservations =
  (change: (o: ScenarioObservation) => ScenarioObservation): Change =>
  (s) => ({ ...s, input: { ...s.input, observations: s.input.observations.map(change) } });

/** Every first look's rows seen 15 minutes later: no row is a first look's any more. */
const laterSightings = withObservations((o) =>
  o.observedAt === '2026-10-06T14:05:00-04:00' ? { ...o, observedAt: '2026-10-06T14:20:00-04:00' } : o,
);

/** Every gcal.event view given changesSince: no first look left. */
const everyViewFollowed: Change = (s) => ({
  ...s,
  input: {
    ...s.input,
    coverage: s.input.coverage.map((v) =>
      v.source === 'gcal.event' ? { ...v, changesSince: '2026-10-06T13:00:00-04:00' } : v,
    ),
  },
});

const proofOf = (tag: string): ((s: Scenario, policy: PolicyView) => boolean) | undefined =>
  V19_RULES.find(([name]) => name === tag)?.[1];

/** The v1.9 proof `tag` on a (changed) copy of scenario `prefix`, with that scenario's own patched policy. */
function proves(tag: string, prefix: string, change: Change = (s) => s): boolean {
  return proofOf(tag)?.(change(scenario(prefix)), policyOf(fileOf(prefix))) === true;
}

describe('golden coverage: the contract v1.9 rules', () => {
  it.each(V19_RULES)('contract:%s has a scenario that exercises it', (tag, prove) => {
    const files = SCENARIOS.filter(([, s]) => s.covers.includes(`contract:${tag}`));
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.some(([file, s]) => prove(s, policyOf(file)))).toBe(true);
  });

  it.each(V19_RULES)('contract:%s is not proved by a plain exact match', (_, prove) => {
    expect(prove(scenario('01'), BASE_POLICY)).toBe(false);
  });
});

/** One broken copy per v1.9 proof: the file without the very thing the rule is about. */
const MUTATIONS: readonly (readonly [tag: string, prefix: string, change: Change])[] = [
  ['receipt_point_coverage', '99', withExpect('c2', { grade: 'NOT_FOUND', ruleId: 'not_found' })],
  [
    'receipt_point_orphan',
    '100',
    withObservations((o) => (o.ref === 'o1' ? { ...o, occurredAt: '2026-10-06T14:03:30-04:00' } : o)),
  ],
  ['calendar_first_look_no_orphan', '101', laterSightings],
  [
    'calendar_change_unfollowed',
    '102',
    withExpect('c1', { reasonCodes: ['coverage.partial', 'match.none'] }),
  ],
  ['calendar_change_followed', '103', everyViewFollowed],
];

describe('every v1.9 proof fails on a broken copy of its own file', () => {
  it('covers every v1.9 tag', () => {
    expect(MUTATIONS.map(([tag]) => tag).sort()).toEqual(V19_RULES.map(([tag]) => tag).sort());
  });

  it.each(MUTATIONS)('contract:%s (file %s)', (tag, prefix, change) => {
    expect(proves(tag, prefix)).toBe(true);
    expect(proves(tag, prefix, change)).toBe(false);
  });
});
