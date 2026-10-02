/**
 * The contract v1.4 rules in the golden suite (docs/grading.md v1.4/v1.5): every v1.4 tag has a scenario that
 * really exercises it, every proof is false on a plain exact match and on a broken copy of its own file, and the
 * v1.4 checks (grants in force, late claims, claim-less defaults, events, the corrected params) reject broken
 * files.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { expectationProblems, refProblems } from './checks';
import { eventProblems } from './checks-events';
import { reasonParamProblems, scenarioParamProblems } from './checks-reasons';
import { grantProblems } from './grants';
import { loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioClaim,
  type ScenarioEvent,
  type ScenarioGrant,
  type ScenarioObservation,
} from './scenario-schema';
import { V14_RULES } from './v14-rules';

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

const withScopeExpect =
  (change: (e: ExpectedReceipt) => ExpectedReceipt): Change =>
  (s) => ({ ...s, expect: s.expect.map((e) => (e.scope === undefined ? e : change(e))) });

const withClaim =
  (ref: string, change: Partial<ScenarioClaim>): Change =>
  (s) => ({
    ...s,
    input: { ...s.input, claims: s.input.claims.map((c) => (c.ref === ref ? { ...c, ...change } : c)) },
  });

const withObservation =
  (ref: string, change: Partial<ScenarioObservation>): Change =>
  (s) => ({
    ...s,
    input: {
      ...s.input,
      observations: s.input.observations.map((o) => (o.ref === ref ? { ...o, ...change } : o)),
    },
  });

const withGrant =
  (ref: string, change: Partial<ScenarioGrant>): Change =>
  (s) => ({
    ...s,
    input: { ...s.input, grants: s.input.grants.map((g) => (g.ref === ref ? { ...g, ...change } : g)) },
  });

const withEvent =
  (index: number, change: (event: ScenarioEvent) => ScenarioEvent): Change =>
  (s) => ({ ...s, events: (s.events ?? []).map((event, i) => (i === index ? change(event) : event)) });

/** The regrade event without its `rejected` / `deleted` flags. */
const plainRegrade = (event: ScenarioEvent): ScenarioEvent =>
  event.event === 'regrade' ? { event: 'regrade', ref: event.ref, evaluatedAt: event.evaluatedAt } : event;

const regradeAt =
  (evaluatedAt: string) =>
  (event: ScenarioEvent): ScenarioEvent =>
    event.event === 'regrade' ? { ...event, evaluatedAt } : event;

const overrideAt =
  (at: string, rejected?: true) =>
  (event: ScenarioEvent): ScenarioEvent => {
    if (event.event !== 'override') return event;
    const { event: kind, ref, grade, reason } = event;
    return { event: kind, ref, grade, reason, at, ...(rejected === undefined ? {} : { rejected }) };
  };

const withoutLateSync: Change = (s) => ({
  ...s,
  input: {
    ...s.input,
    activity: {
      ...s.input.activity,
      adapterSyncs: (s.input.activity?.adapterSyncs ?? []).filter(
        (sync) => sync.lastSyncAt !== '2026-10-06T14:40:00-04:00',
      ),
    },
  },
});

const withoutInputs = (e: ExpectedReceipt): ExpectedReceipt => {
  const copy = { ...e };
  delete copy.inputs;
  return copy;
};

const proofOf = (tag: string): ((s: Scenario, policy: PolicyView) => boolean) | undefined =>
  V14_RULES.find(([name]) => name === tag)?.[1];

/** The v1.4 proof `tag` on a (changed) copy of scenario `prefix`, with that scenario's own patched policy. */
function proves(tag: string, prefix: string, change: Change = (s) => s): boolean {
  return proofOf(tag)?.(change(scenario(prefix)), policyOf(fileOf(prefix))) === true;
}

describe('golden coverage: the contract v1.4 rules', () => {
  it.each(V14_RULES)('contract:%s has a scenario that exercises it', (tag, prove) => {
    const files = SCENARIOS.filter(([, s]) => s.covers.includes(`contract:${tag}`));
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.some(([file, s]) => prove(s, policyOf(file)))).toBe(true);
  });

  it.each(V14_RULES)('contract:%s is not proved by a plain exact match', (_, prove) => {
    expect(prove(scenario('01'), BASE_POLICY)).toBe(false);
  });
});

/** One broken copy per v1.4 proof: the file without the very thing the rule is about. */
const MUTATIONS: readonly (readonly [tag: string, prefix: string, change: Change])[] = [
  ['vague_claim_no_adjacency_suppression', '85', withClaim('c1', { claimedAt: '2026-10-06T13:00:00-04:00' })],
  ['calendar_anchor_first_seen', '86', withObservation('o1', { observedAt: '2026-10-06T14:50:00-04:00' })],
  ['per_source_coverage', '90', withExpect('c2', { grade: 'NOT_FOUND', ruleId: 'not_found' })],
  ['scope_receipt_inputs', '87', withScopeExpect(withoutInputs)],
  ['claim_after_evaluated_ignored', '88', withClaim('c1', { observedAt: '2026-10-06T12:00:00-04:00' })],
  ['grant_latest_updated_at', '89', withGrant('g1', { updatedAt: '2026-10-06T14:00:00-04:00' })],
  ['claimless_default_orphan', '91', withExpect('o1', { observationRefs: ['o1'] })],
  ['claimless_default_scope', '92', withScopeExpect((e) => ({ ...e, state: 'PENDING' }))],
  [
    'regrade_pending_to_final',
    '93',
    (s) => ({ ...s, input: { ...s.input, evaluatedAt: '2026-10-06T14:41:00-04:00' } }),
  ],
  ['regrade_stale_rejected', '93', withEvent(0, plainRegrade)],
  ['regrade_final_rejected', '93', withEvent(2, regradeAt('2026-10-06T14:40:00-04:00'))],
  ['override_before_computed_rejected', '93', withEvent(3, overrideAt('2026-10-06T15:02:00-04:00', true))],
  ['unasked_regrade_stays_unasked', '94', withoutLateSync],
  ['unasked_regrade_deleted', '94', withEvent(1, plainRegrade)],
  ['supersede_replaces', '94', withExpect('o1', { supersededBy: 'c1' })],
  [
    'no_parser_source_param',
    '06',
    withExpect('c1', {
      reasonParams: {
        'coverage.partial': { source: 'gmail.receipt' },
        'coverage.no_parser': {},
        'match.none': {},
      },
    }),
  ],
  [
    'currency_mismatch_param_candidate',
    '81',
    withExpect('c1', {
      reasonParams: {
        'ceiling.currency_mismatch': { currency: 'USD', spendCurrency: 'USD' },
        'match.best': { observationId: 'o1' },
      },
    }),
  ],
  [
    'currency_mismatch_param_claim_first',
    '81',
    withExpect('c3', {
      reasonParams: {
        'ceiling.currency_mismatch': { currency: 'CAD', spendCurrency: 'USD' },
        'match.best': { observationId: 'o3' },
      },
    }),
  ],
];

describe('v14-rules proofs need the rule they prove', () => {
  it.each(MUTATIONS)('%s (%s) fails on a copy without it', (tag, prefix, change) => {
    expect(proves(tag, prefix)).toBe(true);
    expect(proves(tag, prefix, change)).toBe(false);
  });

  it('grant_latest_updated_at (89) needs the grant in force away from every list edge and at evaluatedAt', () => {
    const reordered =
      (order: readonly string[]): Change =>
      (s) => ({
        ...s,
        input: {
          ...s.input,
          grants: order.flatMap((ref) => s.input.grants.filter((g) => g.ref === ref)),
        },
      });
    expect(proves('grant_latest_updated_at', '89', reordered(['g1', 'g3', 'g2', 'g4']))).toBe(true);
    expect(proves('grant_latest_updated_at', '89', reordered(['g1', 'g2', 'g3', 'g4']))).toBe(false);
    expect(proves('grant_latest_updated_at', '89', reordered(['g1', 'g3', 'g4', 'g2']))).toBe(false);
    const earlier = withGrant('g2', { updatedAt: '2026-10-06T14:59:00-04:00' });
    expect(proves('grant_latest_updated_at', '89', earlier)).toBe(false);
  });

  it('every v1.4 proof has a mutation test', () => {
    expect(MUTATIONS.map(([tag]) => tag).sort()).toEqual(V14_RULES.map(([tag]) => tag).sort());
  });
});

describe('v1.4 checks catch broken files', () => {
  it('grants: one instant per agent, a grant in force, inputs.grant is the grant in force', () => {
    expect(grantProblems(scenario('89'))).toEqual([]);
    // The same instant as g2 (2026-10-06T20:00:00+01:00), written in another offset: a tie by instant.
    const tied = withGrant('g3', { updatedAt: '2026-10-06T15:00:00-04:00' })(scenario('89'));
    expect(grantProblems(tied)).toContain('two grants of one agent at one instant');
    const wrong = withExpect('c1', { inputs: { grant: 'g3', priorSpendCents: 0 } })(scenario('89'));
    expect(grantProblems(wrong).join()).toContain('inputs.grant g3 is not the grant in force');
    const future = withGrant('g1', { updatedAt: '2026-10-06T16:00:00-04:00' })(scenario('87'));
    expect(grantProblems(future)).toContain('no grant of muse in force');
  });

  it('a claim first seen after evaluatedAt has no expectation; batch keeps no claim-less default', () => {
    const late = scenario('88');
    expect(refProblems(late)).toEqual([]);
    const [first] = late.expect;
    if (first === undefined) throw new Error('88 has expectations');
    const graded: ExpectedReceipt = { ...first, ref: 'c1', observationRefs: [] };
    expect(refProblems({ ...late, expect: [...late.expect, graded] }).join()).toContain(
      'c1: 1 expectations, want 0',
    );
    const kept = withScopeExpect((e) => ({ ...e, grade: 'UNVERIFIABLE', ruleId: 'default_unverifiable' }));
    expect(refProblems(kept(scenario('87'))).join()).toContain('only when UNASKED or OVER_SCOPE');
  });

  it('a claim-less default_unverifiable is FINAL with no evidence', () => {
    const [orphan] = scenario('91').expect;
    expect(orphan).toBeDefined();
    if (orphan === undefined) return;
    expect(expectationProblems(orphan, BASE_POLICY)).toEqual([]);
    expect(expectationProblems({ ...orphan, state: 'PENDING' }, BASE_POLICY).join()).toContain(
      'claim-less default: FINAL, no evidence',
    );
  });
});

describe('v1.4 checks catch broken events and params', () => {
  it('events: stale regrades and early overrides are rejected, the last supersede wins', () => {
    expect(eventProblems(scenario('93'))).toEqual([]);
    expect(eventProblems(scenario('94'))).toEqual([]);
    expect(eventProblems(withEvent(0, plainRegrade)(scenario('93'))).join()).toContain('must be rejected');
    const early = withEvent(3, overrideAt('2026-10-06T14:44:00-04:00'))(scenario('93'));
    expect(eventProblems(early).join()).toContain('must be rejected');
    const refused = withEvent(4, overrideAt('2026-10-06T15:05:00-04:00', true))(scenario('93'));
    expect(eventProblems(refused).join()).toContain('must be applied');
    expect(eventProblems(withExpect('o1', { supersededBy: 'c1' })(scenario('94'))).join()).toContain(
      'last applied supersede',
    );
    const claimDeleted = withEvent(1, (event) => ({ ...event, ref: 'c1' }))(scenario('94'));
    expect(eventProblems(claimDeleted).join()).toContain('only a PENDING UNASKED orphan is deleted');
  });

  it('params: no_parser carries {source}; a candidate mismatch names the candidate currency', () => {
    const noParser = scenario('06');
    expect(noParser.expect.flatMap(reasonParamProblems)).toEqual([]);
    expect(scenarioParamProblems(noParser, BASE_POLICY)).toEqual([]);
    const bare = withExpect('c1', {
      reasonParams: {
        'coverage.partial': { source: 'gmail.receipt' },
        'coverage.no_parser': {},
        'match.none': {},
      },
    })(noParser);
    expect(scenarioParamProblems(bare, BASE_POLICY).join()).toContain('coverage.no_parser.source');
    const policy = policyOf(fileOf('81'));
    expect(scenarioParamProblems(scenario('81'), policy)).toEqual([]);
    const claimCurrency = withExpect('c1', {
      reasonParams: {
        'ceiling.currency_mismatch': { currency: 'GBP', spendCurrency: 'USD' },
        'match.best': { observationId: 'o1' },
      },
    })(scenario('81'));
    expect(scenarioParamProblems(claimCurrency, policy).join()).toContain('currency is the claim currency');
    const candidateFirst = withExpect('c3', {
      reasonParams: {
        'ceiling.currency_mismatch': { currency: 'CAD', spendCurrency: 'USD' },
        'match.best': { observationId: 'o3' },
      },
    })(scenario('81'));
    expect(scenarioParamProblems(candidateFirst, policy).join()).toContain('currency is the claim currency');
  });
});
