/**
 * The contract v1.10 rules in the golden suite (docs/grading.md v1.10): every v1.10 tag has a scenario that really
 * exercises it, every proof is false on a plain exact match and on a broken copy of its own file, and grading broken
 * copies shows what decides each file: without its first-look marker a row the first look found is UNASKED (Hard
 * Rule 7), and a fresh sync of the stale view makes the capped claim NOT_FOUND (Hard Rule 5).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import type { Receipt } from '../../src/core/schema';
import { buildScenario, loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import { runScenario } from './runner';
import { type ExpectedReceipt, type Scenario, type ScenarioObservation } from './scenario-schema';
import { isMarkerOf, V110_RULES } from './v110-rules';

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

/** Every first-look marker left out of the coverage: what a ledger without markers would hold. */
const withoutMarkers: Change = (s) => ({
  ...s,
  input: {
    ...s.input,
    coverage: s.input.coverage.filter((e) => !s.input.observations.some((o) => isMarkerOf(e, o))),
  },
});

/** o1 stored first seen at `seen` (as a pass stored row by row would have left it), without its marker. */
const firstSeenAt =
  (seen: string): Change =>
  (s) =>
    withoutMarkers({
      ...s,
      input: {
        ...s.input,
        observations: s.input.observations.map((o): ScenarioObservation =>
          o.ref === 'o1' ? { ...o, observedAt: seen } : o,
        ),
      },
    });

/** The October view of 108 synced again at 14:40, after every claim's grace sync. */
const octoberResynced: Change = (s) => ({
  ...s,
  input: {
    ...s.input,
    coverage: s.input.coverage.map((e) =>
      e.windowStart === '2026-10-01T00:00:00-04:00' ? { ...e, lastSyncAt: '2026-10-06T14:40:00-04:00' } : e,
    ),
  },
});

const proofOf = (tag: string): ((s: Scenario, policy: PolicyView) => boolean) | undefined =>
  V110_RULES.find(([name]) => name === tag)?.[1];

/** The v1.10 proof `tag` on a (changed) copy of scenario `prefix`, with that scenario's own patched policy. */
function proves(tag: string, prefix: string, change: Change = (s) => s): boolean {
  return proofOf(tag)?.(change(scenario(prefix)), policyOf(fileOf(prefix))) === true;
}

describe('golden coverage: the contract v1.10 rules', () => {
  it.each(V110_RULES)('contract:%s has a scenario that exercises it', (tag, prove) => {
    const files = SCENARIOS.filter(([, s]) => s.covers.includes(`contract:${tag}`));
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.every(([file, s]) => prove(s, policyOf(file)))).toBe(true);
  });

  it.each(V110_RULES)('contract:%s is not proved by a plain exact match', (_, prove) => {
    expect(prove(scenario('01'), BASE_POLICY)).toBe(false);
  });
});

/** One broken copy per v1.10 proof and file: the file without the very thing the rule is about. */
const MUTATIONS: readonly (readonly [tag: string, prefix: string, change: Change])[] = [
  ['calendar_first_look_marker', '104', withoutMarkers],
  ['calendar_first_look_marker', '105', withoutMarkers],
  ['calendar_first_look_marker', '106', withoutMarkers],
  ['calendar_first_look_marker', '107', withoutMarkers],
  ['calendar_stale_view_capped', '108', withExpect('c1', { grade: 'NOT_FOUND', ruleId: 'not_found' })],
];

describe('every v1.10 proof fails on a broken copy of its own file', () => {
  it('covers every v1.10 tag', () => {
    expect([...new Set(MUTATIONS.map(([tag]) => tag))].sort()).toEqual(V110_RULES.map(([tag]) => tag).sort());
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

const unaskedOf = (receipts: readonly Receipt[], observationId: string): Receipt | undefined =>
  receipts.find((r) => r.grade === 'UNASKED' && r.observationIds[0] === observationId);

describe('what decides the v1.10 files (graded, not read)', () => {
  it.each(['104', '105', '107'])(
    '%s: without its marker, the row the first look found is UNASKED',
    async (prefix) => {
      const kept = await graded(prefix, (s) => s);
      expect(unaskedOf(kept.receipts, kept.id('o1'))).toBeUndefined();
      const broken = await graded(prefix, withoutMarkers);
      expect(unaskedOf(broken.receipts, broken.id('o1'))).toMatchObject({
        state: 'FINAL',
        attribution: 'likely',
      });
    },
  );

  it('106: stored row by row at the refused pass (first seen 14:10, no marker), the row is UNASKED', async () => {
    const broken = await graded('106', firstSeenAt('2026-10-06T14:10:00-04:00'));
    expect(unaskedOf(broken.receipts, broken.id('o1'))).toMatchObject({
      state: 'FINAL',
      attribution: 'likely',
    });
    // The re-derived row without its marker is still spared: the clean pass's first look found it (rule (b)).
    const unmarked = await graded('106', withoutMarkers);
    expect(unaskedOf(unmarked.receipts, unmarked.id('o1'))).toBeUndefined();
  });

  it('108: the October view synced again after the grace sync makes c1 NOT_FOUND, FINAL', async () => {
    const fresh = await graded('108', octoberResynced);
    const c1 = fresh.receipts.find((r) => r.claimId === fresh.id('c1'));
    expect([c1?.grade, c1?.ruleId, c1?.state]).toEqual(['NOT_FOUND', 'not_found', 'FINAL']);
    const c3 = fresh.receipts.find((r) => r.claimId === fresh.id('c3'));
    expect([c3?.grade, c3?.state]).toEqual(['VERIFIED', 'FINAL']);
  });
});
