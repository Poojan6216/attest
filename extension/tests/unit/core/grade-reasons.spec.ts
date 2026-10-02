/**
 * Task 1.5: reason emission, order and params (docs/grading.md §6.4, §15), through `grade()`.
 *
 * Order: the rule's own code first, then `allowlist.unchecked`, then coverage reasons, then match and counterparty
 * reasons, each group in table order. Params are ids, hashes, enum values and integers only.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import {
  Attribution,
  type Claim,
  type GradeContext,
  type Grant,
  type Observation,
  Receipt,
} from '../../../src/core/schema';
import {
  buildClaim,
  buildCoverage,
  buildGrant,
  buildObservation,
  mergePatch,
  PolicyView,
} from '../../golden/build';
import {
  ScenarioClaim,
  ScenarioCoverage,
  ScenarioObservation,
  type ScenarioGrant,
} from '../../golden/scenario-schema';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const VIEW = PolicyView.parse(defaultPolicyJson);

const without = (value: Record<string, unknown>, omit: readonly string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)));

function claimOf(over: Record<string, unknown> = {}, omit: readonly string[] = []): Claim {
  const base = {
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    claimedAt: at('14:02'),
    ...over,
  };
  return buildClaim(ScenarioClaim.parse(without(base, omit)));
}

function obsOf(over: Record<string, unknown> = {}, omit: readonly string[] = []): Observation {
  const base = {
    ref: 'o1',
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    occurredAt: at('14:02'),
    observedAt: at('14:30'),
    ...over,
  };
  return buildObservation(ScenarioObservation.parse(without(base, omit)), [], EVAL, VIEW);
}

const entry = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gmail.sent',
  lastSyncAt: EVAL,
  windowStart: at('12:00'),
  windowEnd: EVAL,
  accountHash: 'acct-a',
  ...over,
});
/** An entry with no account hash (capped at partial without a grant binding). */
const unhashed = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage =>
  ScenarioCoverage.parse(
    Object.fromEntries(Object.entries(entry(over)).filter(([key]) => key !== 'accountHash')),
  );
const grantOf = (over: Partial<ScenarioGrant> = {}): Grant => buildGrant({ agent: 'muse', ...over }, EVAL);
const policyWith = (patch: Record<string, unknown>): Policy =>
  loadPolicy(mergePatch(defaultPolicyJson, patch));

interface Call {
  readonly claim?: Claim | null;
  readonly candidates?: readonly Observation[];
  readonly grant?: Grant;
  readonly coverage?: readonly ScenarioCoverage[];
  readonly evaluatedAt?: string;
  readonly context?: GradeContext;
  readonly policy?: Policy;
}

function run(call: Call): Receipt {
  return Receipt.parse(
    grade(
      call.claim === undefined ? claimOf() : call.claim,
      call.candidates ?? [],
      call.grant ?? grantOf(),
      call.policy ?? DEFAULT_POLICY,
      buildCoverage(call.coverage ?? [entry()], call.evaluatedAt ?? EVAL),
      call.context ?? { priorSpendCents: 0 },
    ),
  );
}

const codes = (receipt: Receipt): string[] => receipt.reasons.map((reason) => reason.code);

describe('match and counterparty reasons (§15)', () => {
  it('match.best names the best candidate; cp.* comes from the best candidate only', () => {
    const exact = obsOf();
    const tagged = obsOf({ ref: 'o2', counterparty: 'priya+news@company.com' });
    expect(codes(run({ candidates: [tagged, exact] }))).toEqual(['match.best']);
    expect(run({ candidates: [tagged, exact] }).reasons[0]?.params).toEqual({ observationId: exact.id });
    expect(codes(run({ candidates: [tagged] }))).toEqual(['match.best', 'cp.plus_tag']);
  });

  it('cp.confusable for a confusable lookalike, cp.non_ascii for an identical non-ASCII address', () => {
    const lookalike = obsOf({ counterparty: 'prıya@company.com' });
    expect(codes(run({ candidates: [lookalike] }))).toEqual([
      'coverage.account_unbound',
      'match.best',
      'cp.confusable',
    ]);
    const identical = 'prıya@company.com';
    const same = run({
      claim: claimOf({ counterparty: identical }),
      candidates: [obsOf({ counterparty: identical })],
    });
    expect([same.grade, ...codes(same)]).toEqual(['VERIFIED', 'match.best', 'cp.non_ascii']);
  });

  it('match.none when nothing was scored: no candidate, or a claim that is never scored', () => {
    expect(codes(run({}))).toEqual(['coverage.account_unbound', 'match.none']);
    const vague = run({ claim: claimOf({}, ['counterparty', 'subjectHint']), candidates: [obsOf()] });
    expect(codes(vague)).toEqual(['claim.too_vague', 'match.none']);
  });

  it('never on a claim-less receipt', () => {
    const attribution = Attribution.parse({ agent: 'muse', scoreBp: 4000, signals: ['agentSessionActive'] });
    const below = run({ claim: null, candidates: [obsOf()], context: { priorSpendCents: 0, attribution } });
    expect([below.ruleId, below.state, below.reasons, below.observationIds]).toEqual([
      'default_unverifiable',
      'FINAL',
      [],
      [],
    ]);
  });
});

describe('allowlist.unchecked (§6.1, §15)', () => {
  const allowlist = grantOf({ counterpartyAllowlist: ['company.com'] });

  it('emitted after the rule code when the allowlist cannot be checked', () => {
    const name = run({ claim: claimOf({ counterparty: 'Priya' }), grant: allowlist });
    expect(codes(name)).toEqual(['allowlist.unchecked', 'coverage.account_unbound', 'match.none']);
    const pending = run({
      claim: claimOf({ counterparty: 'Priya' }),
      grant: allowlist,
      coverage: [entry({ lastSyncAt: at('14:20'), windowEnd: at('14:20') })],
    });
    expect(codes(pending)).toEqual(['grace.waiting', 'allowlist.unchecked', 'match.none']);
  });

  it('not emitted when another rule made the receipt OVER_SCOPE, when checkable, or with an empty allowlist', () => {
    const typeOut = grantOf({ counterpartyAllowlist: ['company.com'], allowedTypes: [] });
    expect(codes(run({ claim: claimOf({ counterparty: 'Priya' }), grant: typeOut }))[0]).toBe(
      'scope.type_not_allowed',
    );
    expect(codes(run({ claim: claimOf({ counterparty: 'Priya' }), grant: typeOut }))).not.toContain(
      'allowlist.unchecked',
    );
    expect(codes(run({ grant: allowlist }))).not.toContain('allowlist.unchecked');
    expect(codes(run({ claim: claimOf({ counterparty: 'Priya' }) }))).not.toContain('allowlist.unchecked');
  });

  it("a name claim's assigned evidence makes it checkable", () => {
    const evidence = obsOf({ counterparty: 'priya@company.com' });
    expect(
      codes(run({ claim: claimOf({ counterparty: 'Priya' }), grant: allowlist, candidates: [evidence] })),
    ).toEqual(['match.best']);
  });
});

describe('coverage reasons (§15)', () => {
  it('capping codes only with partial_coverage, after allowlist.unchecked, each with its source', () => {
    const capped = run({
      claim: claimOf({ counterparty: 'Raj' }),
      grant: grantOf({ counterpartyAllowlist: ['company.com'] }),
      coverage: [unhashed()],
    });
    expect(capped.ruleId).toBe('partial_coverage');
    expect(capped.reasons).toEqual([
      { code: 'coverage.partial', params: { source: 'gmail.sent' } },
      { code: 'allowlist.unchecked', params: {} },
      { code: 'coverage.no_account', params: { source: 'gmail.sent' } },
      { code: 'match.none', params: {} },
    ]);
    const waiting = run({ coverage: [unhashed({ lastSyncAt: at('14:20'), windowEnd: at('14:20') })] });
    expect(codes(waiting)).toEqual(['grace.waiting', 'match.none']);
  });

  it('multiple accounts and hidden calendars are named the same way', () => {
    expect(codes(run({ coverage: [entry(), entry({ accountHash: 'acct-b' })] }))).toEqual([
      'coverage.partial',
      'coverage.multiple_accounts',
      'match.none',
    ]);
    const calendar = claimOf({ type: 'calendar.created', targetAt: at('10:00', '08') });
    const view = entry({
      source: 'gcal.event',
      windowStart: at('00:00', '01'),
      windowEnd: at('00:00', '20'),
    });
    const hidden = run({ claim: calendar, coverage: [view] });
    expect(hidden.reasons.slice(0, 2)).toEqual([
      { code: 'coverage.partial', params: { source: 'gcal.event' } },
      { code: 'coverage.calendars_hidden', params: { source: 'gcal.event' } },
    ]);
  });

  it('coverage.no_parser names the source it capped (§15 v1.4: {source})', () => {
    const purchase = claimOf(
      { type: 'purchase.made', counterparty: 'acme', amountCents: 4999, currency: 'USD' },
      ['subjectHint'],
    );
    const receipt = run({ claim: purchase, coverage: [entry({ source: 'gmail.receipt' })] });
    expect([receipt.ruleId, receipt.state]).toEqual(['partial_coverage', 'PENDING']);
    expect(receipt.reasons).toEqual([
      { code: 'coverage.partial', params: { source: 'gmail.receipt' } },
      { code: 'coverage.no_parser', params: { source: 'gmail.receipt' } },
      { code: 'match.none', params: {} },
    ]);
  });
});

describe('coverage reasons: account_unbound and none (§15)', () => {
  it('coverage.account_unbound only on NOT_FOUND, per source without a grant binding', () => {
    expect(codes(run({ grant: grantOf({ accounts: { 'gmail.sent': ['acct-a'] } }) }))).toEqual([
      'match.none',
    ]);
    const partial = run({
      candidates: [obsOf({ counterparty: 'raj@company.com', subjectHint: 'Q3 budget' })],
    });
    expect([partial.grade, ...codes(partial)]).toEqual(['PARTIAL', 'match.best']);
  });

  it('coverage.none names each relevant source, or carries no params for a type with none', () => {
    expect(run({ coverage: [] }).reasons[0]).toEqual({
      code: 'coverage.none',
      params: { source: 'gmail.sent' },
    });
    const message = run({ claim: claimOf({ type: 'message.sent' }), coverage: [] });
    expect([message.ruleId, message.state, message.reasons]).toEqual([
      'no_coverage',
      'FINAL',
      [
        { code: 'coverage.none', params: {} },
        { code: 'match.none', params: {} },
      ],
    ]);
    const twoSources = policyWith({ sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } });
    expect(run({ coverage: [], policy: twoSources }).reasons.slice(0, 2)).toEqual([
      { code: 'coverage.none', params: { source: 'gmail.sent' } },
      { code: 'coverage.none', params: { source: 'gcal.event' } },
    ]);
  });
});

describe('coverage reasons: grace (§15)', () => {
  it('grace.waiting names only the sources still waiting', () => {
    const twoSources = policyWith({ sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } });
    const calendarLate = entry({
      source: 'gcal.event',
      allCalendars: true,
      lastSyncAt: at('14:20'),
      windowEnd: at('14:20'),
    });
    const receipt = run({ coverage: [entry(), calendarLate], policy: twoSources });
    expect(receipt.reasons[0]).toEqual({ code: 'grace.waiting', params: { source: 'gcal.event' } });
    expect(codes(receipt)).toEqual(['grace.waiting', 'match.none']);
  });

  it('a pending outcome finalised by time carries coverage.never_completed instead of grace.waiting', () => {
    const stale = [entry({ lastSyncAt: at('14:20'), windowEnd: at('14:20') })];
    const final = run({
      coverage: stale,
      evaluatedAt: at('14:03', '07'),
      claim: claimOf({ counterparty: 'Priya' }),
      grant: grantOf({ counterpartyAllowlist: ['company.com'] }),
    });
    expect([final.grade, final.ruleId, final.state, ...codes(final)]).toEqual([
      'UNVERIFIABLE',
      'pending',
      'FINAL',
      'coverage.never_completed',
      'allowlist.unchecked',
      'match.none',
    ]);
  });
});

describe('permission reasons and their params (§15)', () => {
  const ceiling = grantOf({ spendCeilingCents: 5000, spendCurrency: 'USD' });
  const purchase = (over: Record<string, unknown>, omit: readonly string[] = []) =>
    claimOf({ type: 'purchase.made', counterparty: 'acme', ...over }, ['subjectHint', ...omit]);
  const receipt = (over: Record<string, unknown>) =>
    obsOf({ source: 'gmail.receipt', type: 'purchase.made', merchant: 'Acme', ...over }, [
      'counterparty',
      'subjectHint',
    ]);

  it('ceiling.exceeded then ceiling.currency_mismatch when both hold; the mismatching currency is named', () => {
    const both = run({
      claim: purchase({ amountCents: 8000 }, ['currency']),
      candidates: [receipt({ amountCents: 8000, currency: 'CAD' })],
      grant: ceiling,
      coverage: [],
    });
    expect(both.reasons.slice(0, 2)).toEqual([
      { code: 'ceiling.exceeded', params: { amountCents: 8000, ceilingCents: 5000 } },
      { code: 'ceiling.currency_mismatch', params: { currency: 'CAD', spendCurrency: 'USD' } },
    ]);
    const third = run({
      claim: purchase({ amountCents: 3000, currency: 'USD' }),
      candidates: [receipt({ amountCents: 3000, currency: 'EUR' })],
      grant: ceiling,
      coverage: [],
    });
    expect(third.reasons[0]).toEqual({
      code: 'ceiling.currency_mismatch',
      params: { currency: 'EUR', spendCurrency: 'USD' },
    });
  });

  it('ceiling.exceeded names the §6.1 Amount: the larger in-currency amount', () => {
    const bigger = run({
      claim: purchase({ amountCents: 3000, currency: 'USD' }),
      candidates: [receipt({ amountCents: 6000, currency: 'USD' })],
      grant: ceiling,
      coverage: [],
    });
    expect(bigger.reasons[0]).toEqual({
      code: 'ceiling.exceeded',
      params: { amountCents: 6000, ceilingCents: 5000 },
    });
  });
});

describe('UNASKED reasons, and no content in any param (§6.4, §15)', () => {
  it('UNASKED lists the fired signals in table order, each for the attributed agent', () => {
    const attribution = Attribution.parse({
      agent: 'claude',
      scoreBp: 9000,
      signals: ['activityLogAdjacent', 'userIdle', 'agentSignature', 'agentSessionActive'],
    });
    const unasked = run({
      claim: null,
      candidates: [obsOf()],
      grant: buildGrant({ agent: 'claude' }, EVAL),
      context: { priorSpendCents: 0, attribution },
    });
    expect(unasked.reasons).toEqual(
      ['unasked.session', 'unasked.idle', 'unasked.signature', 'unasked.adjacent'].map((code) => ({
        code,
        params: { agent: 'claude' },
      })),
    );
  });

  it('no reason param ever carries an address, a name or a subject (§6.4)', () => {
    const receipts = [
      run({
        claim: claimOf({ counterparty: 'Priya Raman' }),
        grant: grantOf({ counterpartyAllowlist: ['company.com'] }),
      }),
      run({ candidates: [obsOf({ counterparty: 'priya+x@company.com' })] }),
      run({
        claim: claimOf({ counterparty: 'lee@vendor.example' }),
        grant: grantOf({ counterpartyAllowlist: ['company.com'] }),
      }),
    ];
    const values = receipts.flatMap((r) =>
      r.reasons.flatMap((reason) => Object.values(reason.params).map(String)),
    );
    for (const value of values) expect(value).not.toMatch(/@|priya|raman|deck|vendor/i);
  });
});
