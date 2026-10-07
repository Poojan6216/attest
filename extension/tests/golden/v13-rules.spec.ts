/**
 * The contract v1.3 rules in the golden suite (docs/grading.md v1.3): every v1.3 tag has a scenario that
 * really exercises it, every proof is false on a plain exact match and on a broken copy of its own file, and
 * the v1.3 checks (no-parser purchases, the allowlist with no address, the scope hash) reject broken files.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { noParserProblems } from './checks-claims';
import { allowlistUncheckedProblems, reasonParamProblems } from './checks-reasons';
import { loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioClaim,
  type ScenarioObservation,
} from './scenario-schema';
import { V12_RULES } from './v12-rules';
import { V13_RULES } from './v13-rules';
import { V14_RULES } from './v14-rules';
import { V110_RULES } from './v110-rules';
import { V111_RULES } from './v111-rules';
import { V112_RULES } from './v112-rules';
import { V114_RULES } from './v114-rules';
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

const withClaim =
  (ref: string, change: (c: ScenarioClaim) => ScenarioClaim): Change =>
  (s) => ({
    ...s,
    input: { ...s.input, claims: s.input.claims.map((c) => (c.ref === ref ? change(c) : c)) },
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

const both =
  (first: Change, second: Change): Change =>
  (s) =>
    second(first(s));

const withoutParams: Change = (s) => ({
  ...s,
  expect: s.expect.map((e) => {
    const copy = { ...e };
    delete copy.reasonParams;
    return copy;
  }),
});

const proofOf = (tag: string): ((s: Scenario, policy: PolicyView) => boolean) | undefined =>
  V13_RULES.find(([name]) => name === tag)?.[1];

/** The v1.3 proof `tag` on a (changed) copy of scenario `prefix`, with that scenario's own patched policy. */
function proves(tag: string, prefix: string, change: Change = (s) => s): boolean {
  return proofOf(tag)?.(change(scenario(prefix)), policyOf(fileOf(prefix))) === true;
}

describe('golden coverage: the contract v1.3 rules', () => {
  it.each(V13_RULES)('contract:%s has a scenario that exercises it', (tag, prove) => {
    const files = SCENARIOS.filter(([, s]) => s.covers.includes(`contract:${tag}`));
    expect(files.length, tag).toBeGreaterThan(0);
    expect(files.some(([file, s]) => prove(s, policyOf(file)))).toBe(true);
  });

  it.each(V13_RULES)('contract:%s is not proved by a plain exact match', (_, prove) => {
    expect(prove(withoutParams(scenario('01')), BASE_POLICY)).toBe(false);
  });
});

const dropCurrency = (c: ScenarioClaim): ScenarioClaim => {
  const copy = { ...c };
  delete copy.currency;
  return copy;
};

/** One broken copy per v1.3 proof: the file without the very thing the rule is about. */
const MUTATIONS: readonly (readonly [tag: string, prefix: string, change: Change])[] = [
  ['purchase_coverage_by_name', '76', withClaim('c3', (c) => ({ ...c, counterparty: 'acme' }))],
  ['purchase_no_counterparty_capped', '76', withExpect('c2', { ruleId: 'no_coverage' })],
  ['purchase_no_parser_verifies', '78', withExpect('c1', { grade: 'UNVERIFIABLE' })],
  ['no_parser_partial_coverage', '06', withExpect('c1', { reasonCodes: ['coverage.partial', 'match.none'] })],
  [
    'cp_confusable_replaces_plus_tag',
    '79',
    (s) =>
      ['c1', 'c2', 'c4'].reduce(
        (copy, ref) => withExpect(ref, { reasonCodes: ['match.best', 'cp.plus_tag'] })(copy),
        s,
      ),
  ],
  ['xn_any_ascii_case', '79', withExpect('c4', { grade: 'PARTIAL' })],
  ['cp_only_address_claims', '54', withExpect('c4', { reasonCodes: ['match.best', 'cp.plus_tag'] })],
  [
    'allowlist_subject_only_unchecked',
    '80',
    both(
      withClaim('c1', (c) => ({ ...c, counterparty: 'Priya' })),
      withClaim('c2', (c) => ({ ...c, counterparty: 'Priya' })),
    ),
  ],
  [
    'never_completed_before_unchecked',
    '80',
    withExpect('c2', { reasonCodes: ['allowlist.unchecked', 'coverage.never_completed', 'match.none'] }),
  ],
  ['ceiling_third_currency', '81', withClaim('c1', dropCurrency)],
  [
    'ceiling_exceeded_and_mismatch',
    '81',
    withExpect('c2', { reasonCodes: ['ceiling.currency_mismatch', 'match.best'] }),
  ],
  [
    'best_tie_by_observation_id',
    '82',
    (s) => ({
      ...s,
      assertIds: {
        ascending: [
          ['o2', 'o1'],
          ['o4', 'o3'],
        ],
      },
    }),
  ],
  [
    'calendar_first_seen_duplicates',
    '83',
    withObservation('o1', { observedAt: '2026-10-06T14:30:00-04:00' }),
  ],
  ['first_seen_unit_start', '83', withClaim('c2', (c) => ({ ...c, claimedAt: '2026-10-06T14:02:00-04:00' }))],
  ['scope_hash_params', '50', withoutParams],
  [
    'amount_exact_currency_missing',
    '69',
    both(withExpect('c1', { score: '1/1' }), withExpect('c2', { score: '1/1' })),
  ],
  ['bidi_embedding_unread', '84', withExpect('c1', { grade: 'VERIFIED', ruleId: 'verified', score: '1/1' })],
  ['subject_compat_digits', '84', withExpect('c2', { grade: 'PARTIAL', ruleId: 'partial', score: '5/6' })],
  ['merchant_rejected_text', '84', withExpect('c5', { grade: 'PARTIAL', ruleId: 'partial', score: '5/7' })],
];

describe('v13-rules proofs need the rule they prove', () => {
  it.each(MUTATIONS)('%s (%s) fails on a copy without it', (tag, prefix, change) => {
    expect(proves(tag, prefix)).toBe(true);
    expect(proves(tag, prefix, change)).toBe(false);
  });

  it('every v1.3 proof has a mutation test', () => {
    expect(MUTATIONS.map(([tag]) => tag).sort()).toEqual(V13_RULES.map(([tag]) => tag).sort());
  });

  it('the second sub-case of a two-part text proof bites too', () => {
    const nameRead = withExpect('c3', { grade: 'VERIFIED', ruleId: 'verified', score: '1/1' });
    expect(proves('bidi_embedding_unread', '84', nameRead)).toBe(false);
    const observationRead = withExpect('c4', { grade: 'VERIFIED', ruleId: 'verified', score: '1/1' });
    expect(proves('merchant_rejected_text', '84', observationRead)).toBe(false);
  });
});

/**
 * Tags from the v1.0/v1.1 suite that name a scenario's subject rather than a rule with a proof: the §2 demo pair
 * (asserted in scenarios.spec.ts) and two descriptive tags. Every other `contract:` tag must have a proof.
 */
const DESCRIPTIVE_TAGS = [
  'demo',
  'demo_unverifiable',
  'counterparty_domain_plus_tag',
  'grade_mode_claimless',
];

describe('contract tags', () => {
  it('every contract:<tag> a file carries is a proved v1.2/v1.3/v1.4/v1.9/v1.10/v1.11/v1.12/v1.14 rule or a listed descriptive tag', () => {
    const proved = new Set(
      [
        ...V12_RULES,
        ...V13_RULES,
        ...V14_RULES,
        ...V19_RULES,
        ...V110_RULES,
        ...V111_RULES,
        ...V112_RULES,
        ...V114_RULES,
      ].map(([tag]) => tag),
    );
    const unproved = SCENARIOS.flatMap(([file, s]) =>
      s.covers
        .filter((tag) => tag.startsWith('contract:'))
        .map((tag) => tag.slice('contract:'.length))
        .filter((tag) => !proved.has(tag) && !DESCRIPTIVE_TAGS.includes(tag))
        .map((tag) => `${file}: ${tag}`),
    );
    expect(unproved).toEqual([]);
  });
});

describe('v1.3 checks catch broken expectations', () => {
  it('a purchase no parser can see is never NOT_FOUND, and partial_coverage names the cap', () => {
    const noParser = scenario('06');
    expect(noParserProblems(noParser, BASE_POLICY)).toEqual([]);
    const notFound = withExpect('c1', {
      grade: 'NOT_FOUND',
      ruleId: 'not_found',
      state: 'FINAL',
      reasonCodes: ['coverage.account_unbound', 'match.none'],
    })(noParser);
    expect(noParserProblems(notFound, BASE_POLICY)).toContainEqual(
      expect.stringContaining('never NOT_FOUND'),
    );
    const unnamed = withExpect('c1', { reasonCodes: ['coverage.partial', 'match.none'] })(noParser);
    expect(noParserProblems(unnamed, BASE_POLICY)).not.toEqual([]);
    const covered = scenario('76');
    expect(noParserProblems(covered, policyOf(fileOf('76')))).toEqual([]);
    const capped = withExpect('c3', {
      grade: 'UNVERIFIABLE',
      ruleId: 'partial_coverage',
      state: 'PENDING',
      reasonCodes: ['coverage.partial', 'coverage.no_parser', 'match.none'],
    })(covered);
    expect(noParserProblems(capped, policyOf(fileOf('76')))).not.toEqual([]);
  });

  it('a subject-only calendar claim with no evidence must carry allowlist.unchecked', () => {
    const subjectOnly = scenario('80');
    expect(allowlistUncheckedProblems(subjectOnly, BASE_POLICY)).toEqual([]);
    const dropped = withExpect('c1', { reasonCodes: ['match.none'] })(subjectOnly);
    expect(allowlistUncheckedProblems(dropped, BASE_POLICY)).not.toEqual([]);
    const onEvidence = withExpect('c3', { reasonCodes: ['allowlist.unchecked', 'match.best'] })(subjectOnly);
    expect(allowlistUncheckedProblems(onEvidence, BASE_POLICY)).not.toEqual([]);
  });

  it('the scope hash param must hash the receipt scope', () => {
    const [scope] = scenario('50').expect;
    expect(scope).toBeDefined();
    if (scope === undefined) return;
    expect(reasonParamProblems(scope)).toEqual([]);
    const other = { ...scope, reasonParams: { 'scope.observed_not_declared': { scopeHash: 'gmail.send' } } };
    expect(reasonParamProblems(other)).not.toEqual([]);
  });
});
