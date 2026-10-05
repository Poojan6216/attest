/**
 * The contract v1.12 rule in the golden suite (docs/grading.md v1.12): the v1.12 tag has a scenario that really
 * exercises it, its proof is false on a plain exact match and on a broken copy of its own file, and grading that copy
 * shows what the markers decide: a Calendar change stored without its first-look marker, as v1.11's ledger stored a
 * change a followed view saw, is UNASKED next to an agent's activity, whoever made it (Hard Rule 7).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import type { Receipt } from '../../src/core/schema';
import { buildScenario, loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import { runScenario } from './runner';
import { type Scenario } from './scenario-schema';
import { isMarkerOf } from './v110-rules';
import { V112_RULES } from './v112-rules';

const FILES = scenarioFiles();
const SCENARIOS: readonly (readonly [string, Scenario])[] = FILES.map((file) => [file, readScenario(file)]);
const BASE_POLICY = PolicyView.parse(defaultPolicyJson);
const policyOf = (file: string): PolicyView => PolicyView.parse(loadScenario(file).policyJson);
const fileOf = (prefix: string): string => FILES.find((name) => name.startsWith(`${prefix}-`)) ?? '';
const scenario = (prefix: string): Scenario => readScenario(fileOf(prefix));

type Change = (s: Scenario) => Scenario;

/** Every first-look marker left out of the coverage: what v1.11's ledger held for a change a view followed. */
const withoutMarkers: Change = (s) => ({
  ...s,
  input: {
    ...s.input,
    coverage: s.input.coverage.filter((e) => !s.input.observations.some((o) => isMarkerOf(e, o))),
  },
});

/** The file's expectation with an UNASKED receipt for `ref` added. */
const accusing =
  (ref: string): Change =>
  (s) => ({
    ...s,
    expect: [
      ...s.expect,
      {
        ref,
        grade: 'UNASKED',
        ruleId: 'unasked',
        state: 'FINAL',
        observationRefs: [ref],
        score: null,
        reasonCodes: ['unasked.session', 'unasked.idle'],
      },
    ],
  });

const proofOf = (tag: string) => V112_RULES.find(([name]) => name === tag)?.[1];

/** The v1.12 proof `tag` on a (changed) copy of scenario `prefix`, with that scenario's own patched policy. */
function proves(tag: string, prefix: string, change: Change = (s) => s): boolean {
  return proofOf(tag)?.(change(scenario(prefix)), policyOf(fileOf(prefix))) === true;
}

describe('golden coverage: the contract v1.12 rule', () => {
  it.each(V112_RULES)('contract:%s has a scenario that exercises it', (tag, prove) => {
    const files = SCENARIOS.filter(([, s]) => s.covers.includes(`contract:${tag}`));
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.every(([file, s]) => prove(s, policyOf(file)))).toBe(true);
  });

  it.each(V112_RULES)('contract:%s is not proved by a plain exact match', (_, prove) => {
    expect(prove(scenario('01'), BASE_POLICY)).toBe(false);
  });
});

/** One broken copy per v1.12 proof and file: the file without the very thing the rule is about. */
const MUTATIONS: readonly (readonly [tag: string, prefix: string, change: Change])[] = [
  ['calendar_changes_marked', '112', withoutMarkers],
  ['calendar_changes_marked', '112', accusing('o3')],
];

describe('every v1.12 proof fails on a broken copy of its own file', () => {
  it('covers every v1.12 tag', () => {
    expect([...new Set(MUTATIONS.map(([tag]) => tag))].sort()).toEqual(V112_RULES.map(([tag]) => tag).sort());
  });

  it.each(MUTATIONS)('contract:%s (file %s)', (tag, prefix, change) => {
    expect(proves(tag, prefix)).toBe(true);
    expect(proves(tag, prefix, change)).toBe(false);
  });
});

/** The receipts of a (changed) copy of scenario `prefix`, graded through the core, and the id of its `ref`. */
async function graded(
  prefix: string,
  change: Change,
): Promise<{ receipts: readonly Receipt[]; id: (ref: string) => string }> {
  const loaded = buildScenario(fileOf(prefix), change(scenario(prefix)));
  const run = await runScenario(loaded);
  const id = (ref: string): string => loaded.observations.get(ref)?.id ?? loaded.claims.get(ref)?.id ?? '';
  return { receipts: run.receipts, id };
}

describe('what decides the v1.12 file (graded, not read)', () => {
  it('112: without their markers, the invitation, the cancellation and the colleague’s edit are UNASKED', async () => {
    const kept = await graded('112', (s) => s);
    expect(kept.receipts.filter((r) => r.grade === 'UNASKED')).toEqual([]);
    const broken = await graded('112', withoutMarkers);
    const unasked = broken.receipts.filter((r) => r.grade === 'UNASKED');
    expect(unasked.map((r) => r.observationIds[0]).sort()).toEqual(
      ['o1', 'o3', 'o4'].map((ref) => broken.id(ref)).sort(),
    );
    for (const receipt of unasked) expect(receipt).toMatchObject({ state: 'FINAL', attribution: 'likely' });
    // The claim reads the same change row either way: a marker is never a candidate.
    const claim = broken.receipts.find((r) => r.claimId === broken.id('c1'));
    expect([claim?.grade, claim?.state, claim?.observationIds]).toEqual([
      'VERIFIED',
      'FINAL',
      [broken.id('o2')],
    ]);
  });
});
