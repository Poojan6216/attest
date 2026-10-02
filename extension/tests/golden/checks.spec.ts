/**
 * The golden checks bite: each check in checks.ts, checks-reasons.ts and v12-rules.ts rejects a deliberately
 * broken copy of a real scenario expectation. Without these, a check that always returned [] would let
 * scenarios.spec.ts pass on files that contradict docs/grading.md.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { expectationProblems, reasonOrderProblems, refProblems } from './checks';
import { claimProblems } from './checks-claims';
import { allowlistUncheckedProblems, reasonParamProblems, scenarioParamProblems } from './checks-reasons';
import { loadScenario, PolicyView, readScenario, scenarioFiles } from './load';
import { type ExpectedReceipt, type Scenario } from './scenario-schema';
import { V12_RULES } from './v12-rules';

const BASE_POLICY = PolicyView.parse(defaultPolicyJson);

function scenario(prefix: string): Scenario {
  const file = scenarioFiles().find((name) => name.startsWith(`${prefix}-`)) ?? '';
  return readScenario(file);
}

function expectation(prefix: string, ref: string): ExpectedReceipt {
  const found = scenario(prefix).expect.find((e) => e.ref === ref);
  if (found === undefined) throw new Error(`no expectation ${ref} in ${prefix}`);
  return found;
}

/** The scenario with one expectation replaced. */
function withExpect(s: Scenario, ref: string, change: Partial<ExpectedReceipt>): Scenario {
  return { ...s, expect: s.expect.map((e) => (e.ref === ref ? { ...e, ...change } : e)) };
}

/** The scenario as a reader that asserts reason codes only. */
function withoutParams(s: Scenario): Scenario {
  return {
    ...s,
    expect: s.expect.map((e) => {
      const copy = { ...e };
      delete copy.reasonParams;
      return copy;
    }),
  };
}

const PENDING_MATCH_NONE: Partial<ExpectedReceipt> = {
  ruleId: 'pending',
  grade: 'UNVERIFIABLE',
  score: null,
  observationRefs: [],
};

const EXPECTATION_MUTATIONS: readonly (readonly [string, Partial<ExpectedReceipt>])[] = [
  ['a VERIFIED score below thresholds.verified', { score: '1/2' }],
  ['match.best without a score', { score: null }],
  ['both match codes', { reasonCodes: ['match.best', 'match.none'] }],
  [
    'match before the rule reason',
    { ruleId: 'over_scope', grade: 'OVER_SCOPE', reasonCodes: ['match.best', 'scope.type_not_allowed'] },
  ],
  ['a grade the rule cannot give', { grade: 'PARTIAL' }],
  [
    'evidence for an unassigned pair',
    { grade: 'NOT_FOUND', ruleId: 'not_found', score: '4/9', reasonCodes: ['match.best'] },
  ],
  ['an account cap outside partial_coverage', { reasonCodes: ['coverage.no_account', 'match.best'] }],
  ['an override reason without the state', { reasonCodes: ['match.best', 'override.user'] }],
  [
    'a PENDING receipt with coverage.never_completed',
    { ...PENDING_MATCH_NONE, state: 'PENDING', reasonCodes: ['coverage.never_completed', 'match.none'] },
  ],
  [
    'a FINAL pending outcome still waiting for grace',
    { ...PENDING_MATCH_NONE, reasonCodes: ['grace.waiting', 'match.none'] },
  ],
  [
    'account_unbound on a receipt that is not NOT_FOUND',
    { reasonCodes: ['coverage.account_unbound', 'match.best'] },
  ],
  ['a PARTIAL score at or above thresholds.verified', { grade: 'PARTIAL', ruleId: 'partial' }],
  [
    'allowlist.unchecked before coverage.never_completed, the pending rule code (v1.3 order)',
    {
      ...PENDING_MATCH_NONE,
      reasonCodes: ['allowlist.unchecked', 'coverage.never_completed', 'match.none'],
    },
  ],
  ['the no-parser cap outside partial_coverage', { reasonCodes: ['coverage.no_parser', 'match.best'] }],
  [
    'a pending outcome whose best score the partial rule would have matched first',
    {
      ruleId: 'pending',
      grade: 'UNVERIFIABLE',
      state: 'PENDING',
      reasonCodes: ['grace.waiting', 'match.best'],
    },
  ],
  [
    'a partial_coverage outcome with an assigned candidate',
    {
      ruleId: 'partial_coverage',
      grade: 'UNVERIFIABLE',
      state: 'PENDING',
      score: '9/14',
      reasonCodes: ['coverage.partial', 'coverage.no_account', 'match.best'],
    },
  ],
];

describe('checks.ts catches broken expectations', () => {
  const base = expectation('01', 'c1');

  it.each(EXPECTATION_MUTATIONS)('%s', (_, change) => {
    expect(expectationProblems({ ...base, ...change }, BASE_POLICY)).not.toEqual([]);
  });
});

describe('checks.ts reason order (§15 v1.3)', () => {
  it('flags reason lists out of the v1.3 order, and accepts the v1.3 order', () => {
    expect(reasonOrderProblems(['match.none', 'coverage.account_unbound'])).not.toEqual([]);
    expect(reasonOrderProblems(['unasked.idle', 'unasked.session'])).not.toEqual([]);
    expect(
      reasonOrderProblems(['coverage.account_unbound', 'allowlist.unchecked', 'match.none']),
    ).not.toEqual([]);
    expect(
      reasonOrderProblems(['coverage.partial', 'coverage.no_account', 'allowlist.unchecked']),
    ).not.toEqual([]);
    expect(reasonOrderProblems(['override.user', 'match.none'])).not.toEqual([]);
    expect(reasonOrderProblems(['coverage.partial', 'allowlist.unchecked', 'coverage.no_account'])).toEqual(
      [],
    );
    expect(
      reasonOrderProblems(['coverage.partial', 'coverage.no_parser', 'coverage.no_account']),
    ).not.toEqual([]);
    expect(reasonOrderProblems(['coverage.never_completed', 'allowlist.unchecked', 'match.none'])).toEqual(
      [],
    );
  });
});

describe('checks.ts claim-less and subject checks', () => {
  it('flags an UNASKED receipt below the threshold', () => {
    const unasked = expectation('07', 'o1');
    expect(expectationProblems({ ...unasked, attributionScore: '1/2' }, BASE_POLICY)).not.toEqual([]);
  });

  it('flags an attribution score that is not the fired signals, and userIdle alone', () => {
    const unasked = expectation('07', 'o1');
    expect(expectationProblems(unasked, BASE_POLICY)).toEqual([]);
    const inflated = expectationProblems({ ...unasked, attributionScore: '4/5' }, BASE_POLICY);
    expect(inflated).toContainEqual(expect.stringContaining('attributionScore'));
    const idleOnly = { ...unasked, reasonCodes: ['unasked.idle' as const], attributionScore: '7/10' };
    expect(expectationProblems(idleOnly, BASE_POLICY)).toContainEqual(
      expect.stringContaining('agent-specific'),
    );
  });

  it('flags a claim reason on a claim-less receipt', () => {
    const unasked = expectation('07', 'o1');
    const unchecked = { ...unasked, reasonCodes: [...unasked.reasonCodes, 'allowlist.unchecked' as const] };
    expect(expectationProblems(unchecked, BASE_POLICY)).toContainEqual(expect.stringContaining('claim-less'));
    const [scope] = scenario('50').expect;
    expect(scope).toBeDefined();
    if (scope === undefined) return;
    expect(expectationProblems(scope, BASE_POLICY)).toEqual([]);
    const covered = { ...scope, reasonCodes: [...scope.reasonCodes, 'coverage.account_unbound' as const] };
    expect(expectationProblems(covered, BASE_POLICY)).toContainEqual(expect.stringContaining('claim-less'));
  });

  it('flags a claim graded twice, an observation used twice, and an unknown ref', () => {
    const two = scenario('10');
    const both = two.expect.map((e) => ({ ...e, grade: 'VERIFIED' as const, observationRefs: ['o1'] }));
    expect(refProblems({ ...two, expect: both })).not.toEqual([]);
    expect(refProblems({ ...two, expect: two.expect.slice(1) })).not.toEqual([]);
    const first = expectation('10', 'c1');
    expect(refProblems({ ...two, expect: [...two.expect, { ...first, ref: 'c7' }] })).not.toEqual([]);
  });
});

const ORDERED = expectation('74', 'c1');
const CEILING = expectation('09', 'c1');

const PARAM_MUTATIONS: readonly (readonly [string, ExpectedReceipt])[] = [
  ['a code without params', { ...ORDERED, reasonParams: { 'match.none': {} } }],
  [
    'an extra param',
    { ...ORDERED, reasonParams: { ...ORDERED.reasonParams, 'match.none': { source: 'gmail.sent' } } },
  ],
  [
    'a param of the wrong kind',
    { ...ORDERED, reasonParams: { ...ORDERED.reasonParams, 'override.user': { grade: 'PARTIAL' } } },
  ],
  ['an override param that is not the override', { ...ORDERED, override: 'NOT_FOUND' }],
  [
    'ceiling.exceeded that does not exceed',
    {
      ...CEILING,
      reasonParams: {
        ...CEILING.reasonParams,
        'ceiling.exceeded': { amountCents: 10, ceilingCents: 5000 },
      },
    },
  ],
  [
    'match.best naming an unassigned candidate',
    { ...expectation('01', 'c1'), reasonParams: { 'match.best': { observationId: 'o2' } } },
  ],
];

describe('checks-reasons.ts catches broken params', () => {
  it.each(PARAM_MUTATIONS)('%s', (_, broken) => {
    expect(reasonParamProblems(broken)).not.toEqual([]);
  });

  it('flags params that disagree with the claim, its grant or its type', () => {
    const noSource = scenario('45');
    const sourced = withExpect(noSource, 'c1', {
      reasonParams: { 'coverage.none': { source: 'gmail.sent' }, 'match.none': {} },
    });
    expect(scenarioParamProblems(sourced, BASE_POLICY)).not.toEqual([]);
    const over = scenario('09');
    const wrongCeiling = withExpect(over, 'c1', {
      reasonParams: { 'ceiling.exceeded': { amountCents: 20000, ceilingCents: 4000 }, 'match.none': {} },
    });
    expect(scenarioParamProblems(wrongCeiling, BASE_POLICY)).not.toEqual([]);
    const mismatch = scenario('69');
    const wrongCurrency = withExpect(mismatch, 'c1', {
      reasonParams: {
        'ceiling.currency_mismatch': { currency: 'EUR', spendCurrency: 'USD' },
        'match.best': { observationId: 'o1' },
      },
    });
    expect(scenarioParamProblems(wrongCurrency, BASE_POLICY)).not.toEqual([]);
  });

  it('flags a ceiling.exceeded amount that is not the §6.1 Amount', () => {
    const fromReceipt = scenario('35');
    expect(scenarioParamProblems(fromReceipt, BASE_POLICY)).toEqual([]);
    const claimAmount = withExpect(fromReceipt, 'c1', {
      reasonParams: {
        'ceiling.exceeded': { amountCents: 3000, ceilingCents: 5000 },
        'match.best': { observationId: 'o1' },
      },
    });
    expect(scenarioParamProblems(claimAmount, BASE_POLICY)).toContainEqual(
      expect.stringContaining('§6.1 Amount'),
    );
  });
});

describe('checks-claims.ts catches scored ineligible claims and evidence of another type', () => {
  it.each([
    ['24', 'c1', 'an underspecified claim'],
    ['26', 'c1', 'a calendar claim without targetAt'],
    ['45', 'c1', 'a claim whose type has no sources'],
  ] as const)('%s %s: %s is never scored', (prefix, ref, what) => {
    const s = scenario(prefix);
    expect(claimProblems(s, BASE_POLICY), what).toEqual([]);
    const scored = withExpect(s, ref, {
      score: '1/2',
      reasonCodes: [...expectation(prefix, ref).reasonCodes.filter((c) => c !== 'match.none'), 'match.best'],
    });
    expect(claimProblems(withoutParams(scored), BASE_POLICY), what).toContainEqual(
      expect.stringContaining('never scored'),
    );
  });

  it('flags evidence whose type is not the claim type', () => {
    const exact = scenario('01');
    expect(claimProblems(exact, BASE_POLICY)).toEqual([]);
    const otherType = {
      ...exact,
      input: {
        ...exact.input,
        observations: exact.input.observations.map((o) => ({ ...o, type: 'calendar.created' as const })),
      },
    };
    expect(claimProblems(otherType, BASE_POLICY)).toContainEqual(expect.stringContaining('not a email.sent'));
  });
});

describe('checks-reasons.ts catches a broken allowlist.unchecked', () => {
  it('flags a missing or a misplaced allowlist.unchecked', () => {
    const named = scenario('74');
    const dropped = withExpect(named, 'c1', {
      reasonCodes: ['coverage.account_unbound', 'match.none', 'override.user'],
    });
    expect(allowlistUncheckedProblems(dropped, BASE_POLICY)).not.toEqual([]);
    const overScope = withExpect(named, 'c3', {
      reasonCodes: ['scope.type_not_allowed', 'allowlist.unchecked', 'match.none'],
    });
    expect(allowlistUncheckedProblems(overScope, BASE_POLICY)).not.toEqual([]);
    const assigned = scenario('71');
    const checked = withExpect(assigned, 'c2', { reasonCodes: ['allowlist.unchecked', 'match.best'] });
    expect(allowlistUncheckedProblems(checked, BASE_POLICY)).not.toEqual([]);
  });
});

describe('v12-rules.ts proofs are not vacuous', () => {
  const plain = withoutParams(scenario('01'));

  it.each(V12_RULES)('contract:%s is not proved by a plain exact match', (_, proves) => {
    expect(proves(plain, BASE_POLICY)).toBe(false);
  });

  it('the DST proof fails without the 25th hour, and the currency proof fails without a waiting receipt', () => {
    const [, dst] = V12_RULES.find(([tag]) => tag === 'claimed_at_end_dst') ?? [];
    const dstFile = scenario('68');
    const early = {
      ...dstFile,
      input: {
        ...dstFile.input,
        observations: dstFile.input.observations.map((o) =>
          o.ref === 'o1' ? { ...o, occurredAt: '2026-11-01T22:50:00-08:00' } : o,
        ),
      },
    };
    expect(
      dst?.(dstFile, PolicyView.parse(loadScenario('68-day-precision-claimed-at-end-dst.json').policyJson)),
    ).toBe(true);
    expect(dst?.(early, BASE_POLICY)).toBe(false);
    const [, currency] = V12_RULES.find(([tag]) => tag === 'ceiling_candidate_currency') ?? [];
    const mismatch = scenario('69');
    expect(currency?.(withExpect(mismatch, 'c2', { state: 'FINAL' }), BASE_POLICY)).toBe(false);
  });
});

/** One v1.2 proof, run with the shipped policy. */
function proof(tag: string): (s: Scenario) => boolean {
  const [, found] = V12_RULES.find(([name]) => name === tag) ?? [];
  return (s) => found?.(s, BASE_POLICY) === true;
}

describe('v12-rules.ts proofs need the rule they prove', () => {
  it('the bidi proof needs an override that is not VERIFIED, and the orphan proof needs an agent signal', () => {
    const bidi = scenario('72');
    expect(proof('subject_bidi_override')(bidi)).toBe(true);
    expect(proof('subject_bidi_override')(withExpect(bidi, 'c2', { grade: 'VERIFIED' }))).toBe(false);
    const plainSubject = {
      ...bidi,
      input: {
        ...bidi.input,
        observations: bidi.input.observations.map((o) =>
          o.ref === 'o2' ? { ...o, subjectHint: 'Q3 deck' } : o,
        ),
      },
    };
    expect(proof('subject_bidi_override')(plainSubject)).toBe(false);
    const orphans = scenario('73');
    expect(proof('batch_claimless_outputs')(orphans)).toBe(true);
    const quiet = {
      ...orphans,
      input: { ...orphans.input, activity: { ...orphans.input.activity, sessions: [] } },
    };
    expect(proof('batch_claimless_outputs')(quiet)).toBe(false);
  });

  it('the xn-- proof needs the xn-- label on both sides of a VERIFIED pair', () => {
    const xn = scenario('70');
    expect(proof('identical_xn_address')(xn)).toBe(true);
    const unicode = withExpect(xn, 'c1', { grade: 'PARTIAL' });
    expect(proof('identical_xn_address')(withExpect(unicode, 'c3', { grade: 'PARTIAL' }))).toBe(false);
  });
});

/** One v1.2 proof on a mutated copy of a scenario, with that scenario's own patched policy. */
function proves(tag: string, prefix: string, change: (s: Scenario) => Scenario = (s) => s): boolean {
  const [, found] = V12_RULES.find(([name]) => name === tag) ?? [];
  const file = scenarioFiles().find((name) => name.startsWith(`${prefix}-`)) ?? '';
  return found?.(change(scenario(prefix)), PolicyView.parse(loadScenario(file).policyJson)) === true;
}

const counterparty = (ref: string, value: string) => (s: Scenario) => ({
  ...s,
  input: {
    ...s.input,
    claims: s.input.claims.map((c) => (c.ref === ref ? { ...c, counterparty: value } : c)),
  },
});

describe('v12-rules.ts proofs for 75 and 77 need the rule they prove', () => {
  it.each([
    [
      'name_local_part_ascii_only',
      '75',
      (s: Scenario) => withExpect(withExpect(s, 'c2', { grade: 'VERIFIED' }), 'c3', { grade: 'VERIFIED' }),
    ],
    ['name_local_part_ascii_only', '75', (s: Scenario) => withExpect(s, 'c1', { grade: 'PARTIAL' })],
    ['name_bidi_override', '75', counterparty('c4', 'Priya')],
    ['prior_spend_reads_final_claims', '77', (s: Scenario) => ({ ...s, input: { ...s.input, fixed: [] } })],
  ] as const)('%s (%s) fails on a copy without it', (tag, prefix, change) => {
    expect(proves(tag, prefix)).toBe(true);
    expect(proves(tag, prefix, change)).toBe(false);
  });
});
