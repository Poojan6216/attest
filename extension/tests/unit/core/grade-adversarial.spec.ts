/**
 * Adversarial cases for `grade()` (docs/grading.md §3, §6.1, §8, §15): the edges a rule-by-rule test does not
 * reach. Claim-less outcomes a policy could write (§8: anything but UNASKED or OVER_SCOPE is the terminal rule),
 * `-0` inputs that hash like `0` (§10), the instant boundaries of every finality row (closed: `≥`), the §3
 * input filters at the exact instant, allowlist entry forms (§6.1), several relevant sources, an empty account
 * binding, and corrupt duplicate candidates in either order.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade } from '../../../src/core/grade';
import { canonicalJson } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import {
  Attribution,
  type Claim,
  type Coverage,
  type GradeContext,
  Grant,
  IsoTs,
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
  type ScenarioCoverage,
  type ScenarioGrant,
  ScenarioObservation,
} from '../../golden/scenario-schema';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const VIEW = PolicyView.parse(defaultPolicyJson);
const NO_CONTEXT: GradeContext = { priorSpendCents: 0 };

function claimOf(over: Record<string, unknown> = {}): Claim {
  const base = {
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    claimedAt: at('14:02'),
    ...over,
  };
  return buildClaim(ScenarioClaim.parse(base));
}

function obsOf(over: Record<string, unknown> = {}): Observation {
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
  return buildObservation(ScenarioObservation.parse(base), [], EVAL, VIEW);
}

const entry = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gmail.sent',
  lastSyncAt: EVAL,
  windowStart: at('12:00'),
  windowEnd: EVAL,
  accountHash: 'acct-a',
  ...over,
});
/** One gmail.sent entry (acct-a) that saw [12:00, `iso`] and synced at `iso`. */
const syncedAt = (iso: string, evaluatedAt = EVAL): Coverage =>
  buildCoverage([entry({ lastSyncAt: iso, windowEnd: iso })], evaluatedAt);
const grantOf = (over: Partial<ScenarioGrant> = {}): Grant => buildGrant({ agent: 'muse', ...over }, EVAL);
const codes = (receipt: Receipt): string[] => receipt.reasons.map((reason) => reason.code);

function run(
  claim: Claim | null,
  candidates: readonly Observation[],
  coverage: Coverage = buildCoverage([entry()], EVAL),
  grant: Grant = grantOf(),
  context: GradeContext = NO_CONTEXT,
  policy: Policy = DEFAULT_POLICY,
): Receipt {
  return Receipt.parse(grade(claim, candidates, grant, policy, coverage, context));
}

const ATTRIBUTION = Attribution.parse({ agent: 'muse', scoreBp: 7000, signals: ['agentSessionActive'] });

describe('§8: a claim-less grade reaches only UNASKED, OVER_SCOPE or the terminal rule', () => {
  const quiet = (then: string): Policy =>
    loadPolicy(
      mergePatch(defaultPolicyJson, {
        rules: [{ id: 'quiet', when: { unaskedLikely: false }, then }, ...defaultPolicyJson.rules],
      }),
    );
  const low = Attribution.parse({ agent: 'muse', scoreBp: 100, signals: ['agentSessionActive'] });
  const orphan = obsOf({ observedAt: EVAL });

  it.each(['NOT_FOUND', 'VERIFIED', 'PARTIAL', 'UNVERIFIABLE'])(
    'a policy rule concluding %s for an orphan gives default_unverifiable, FINAL, no evidence',
    (then) => {
      const receipt = run(
        null,
        [orphan],
        undefined,
        undefined,
        { priorSpendCents: 0, attribution: low },
        quiet(then),
      );
      expect([receipt.grade, receipt.ruleId, receipt.state]).toEqual([
        'UNVERIFIABLE',
        'default_unverifiable',
        'FINAL',
      ]);
      expect(receipt.observationIds).toEqual([]);
      expect(receipt.reasons).toEqual([]);
      expect(receipt.finalAt).toBe(EVAL);
    },
  );

  it('the same rule still decides a claim (only claim-less grades are restricted)', () => {
    const policy = loadPolicy(
      mergePatch(defaultPolicyJson, {
        rules: [{ id: 'quiet', when: { typeNotInGrant: false }, then: 'NOT_FOUND' }],
      }),
    );
    expect(run(claimOf(), [], undefined, undefined, NO_CONTEXT, policy).ruleId).toBe('quiet');
  });
});

describe('§10: -0 hashes like 0, so it grades like 0', () => {
  const ceiling = grantOf({ spendCeilingCents: 0, spendCurrency: 'USD' });
  const cover = buildCoverage([entry({ source: 'gmail.receipt' })], EVAL);
  const zero = claimOf({ type: 'purchase.made', counterparty: 'acme', amountCents: 0, currency: 'USD' });

  it('a -0 amount or prior spend gives the identical receipt, params included (Object.is)', () => {
    const plain = run(zero, [], cover, ceiling, { priorSpendCents: 1 });
    const negative = run({ ...zero, amountCents: -0 }, [], cover, ceiling, { priorSpendCents: 1 });
    expect(negative).toStrictEqual(plain);
    expect(Object.is(negative.reasons[0]?.params.amountCents, 0)).toBe(true);
    const prior = run(zero, [], cover, ceiling, { priorSpendCents: -0 });
    expect(prior).toStrictEqual(run(zero, [], cover, ceiling, NO_CONTEXT));
  });

  it('a -0 ceiling is written as 0 in ceiling.cumulative_exceeded', () => {
    const negative = Grant.parse({ ...ceiling, spendCeilingCents: -0 });
    const receipt = run(zero, [], cover, negative, { priorSpendCents: 1 });
    expect(receipt.reasons[0]).toEqual({
      code: 'ceiling.cumulative_exceeded',
      params: { priorSpendCents: 1, amountCents: 0, ceilingCents: 0 },
    });
    expect(Object.is(receipt.reasons[0]?.params.ceilingCents, 0)).toBe(true);
  });
});

describe('§3 filters and §8 finality at the exact instant (every bound is closed)', () => {
  it('a coverage entry synced at evaluatedAt counts; 1 ms later it is ignored', () => {
    expect(run(claimOf(), [], syncedAt(EVAL)).ruleId).toBe('not_found');
    const late = run(claimOf(), [], syncedAt('2026-10-06T15:00:00.001-04:00'));
    expect([late.ruleId, late.state, codes(late)]).toEqual([
      'no_coverage',
      'PENDING',
      ['coverage.none', 'match.none'],
    ]);
  });

  it('a candidate observed at evaluatedAt is seen; 1 ms later it is not', () => {
    const coverage = syncedAt(EVAL);
    expect(run(claimOf(), [obsOf({ observedAt: EVAL })], coverage).ruleId).toBe('verified');
    const late = obsOf({ observedAt: '2026-10-06T15:00:00.001-04:00' });
    expect(run(claimOf(), [late], coverage).ruleId).toBe('not_found');
  });

  it('VERIFIED is FINAL from a sync at end(p,t) + graceMin (14:03 + 30 min)', () => {
    expect(run(claimOf(), [obsOf()], syncedAt('2026-10-06T14:32:59.999-04:00')).state).toBe('PENDING');
    expect(run(claimOf(), [obsOf()], syncedAt(at('14:33'))).state).toBe('FINAL');
  });

  it('graceElapsed from a sync at end(p,t) + afterClaimMin (14:03 + 45 min): pending, then not_found', () => {
    const before = run(claimOf(), [], syncedAt('2026-10-06T14:47:59.999-04:00'));
    expect([before.ruleId, before.state, before.reasons]).toEqual([
      'pending',
      'PENDING',
      [
        { code: 'grace.waiting', params: { source: 'gmail.sent' } },
        { code: 'match.none', params: {} },
      ],
    ]);
    expect(run(claimOf(), [], syncedAt(at('14:48'))).ruleId).toBe('not_found');
  });

  it('coverage-based UNVERIFIABLE is FINAL at end(p,t) + finalizeUnverifiableHours', () => {
    const before = '2026-10-07T14:02:59.999-04:00';
    expect(run(claimOf(), [], buildCoverage([], before)).state).toBe('PENDING');
    const due = run(claimOf(), [], buildCoverage([], at('14:03', '07')));
    expect([due.ruleId, due.state, due.finalAt]).toEqual(['no_coverage', 'FINAL', at('14:03', '07')]);
  });

  it('UNASKED is FINAL from an adapter sync at occurredAt + beforeClaimMin + graceMin, or by time', () => {
    const unasked = (sync: string | undefined, evaluatedAt = EVAL) =>
      run(null, [obsOf({ observedAt: evaluatedAt })], buildCoverage([], evaluatedAt), grantOf(), {
        priorSpendCents: 0,
        attribution: Attribution.parse({
          ...ATTRIBUTION,
          ...(sync === undefined ? {} : { adapterLastSyncAt: sync }),
        }),
      });
    expect(unasked('2026-10-06T14:33:59.999-04:00').state).toBe('PENDING');
    expect(unasked(at('14:34')).state).toBe('FINAL');
    expect(unasked(undefined, '2026-10-07T14:01:59.999-04:00').state).toBe('PENDING');
    expect(unasked(undefined, at('14:02', '07')).state).toBe('FINAL');
  });
});

describe('§6.1 allowlist entry forms', () => {
  const graded = (allowlist: string[], counterparty: string) =>
    run(claimOf({ counterparty }), [], undefined, grantOf({ counterpartyAllowlist: allowlist })).ruleId;

  it.each([
    [['Company.COM'], 'priya@company.com', 'not_found'],
    [['company.com'], 'priya@MAIL.company.com', 'not_found'],
    [['PRIYA@company.com'], 'Priya@Company.com', 'not_found'],
    [['company.com'], 'priya@evilcompany.com', 'over_allowlist'],
    [['company.com'], 'priya@company.com.evil.org', 'over_allowlist'],
    [['priya@company.com'], 'priya+x@company.com', 'over_allowlist'],
    [['company.com'], 'prıya@company.com', 'over_allowlist'],
    [['company.com'], 'priya@xn--cmpany-7ua.com', 'over_allowlist'],
  ])('%j allows %s? → %s', (allowlist, counterparty, ruleId) => {
    expect(graded(allowlist, counterparty)).toBe(ruleId);
  });
});

describe('§6.1 eligibility edges', () => {
  it('an empty account binding makes no entry eligible: no_coverage, never NOT_FOUND', () => {
    const grant = Grant.parse({ ...grantOf(), accounts: { 'gmail.sent': [] } });
    const receipt = run(claimOf(), [], undefined, grant);
    expect([receipt.ruleId, codes(receipt)]).toEqual(['no_coverage', ['coverage.none', 'match.none']]);
  });

  it('two relevant sources: one fully seen and one never seen is pending, then partial, never NOT_FOUND', () => {
    const policy = loadPolicy(
      mergePatch(defaultPolicyJson, { sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } }),
    );
    const waiting = run(claimOf(), [], undefined, undefined, NO_CONTEXT, policy);
    expect(waiting.reasons).toEqual([
      { code: 'grace.waiting', params: { source: 'gcal.event' } },
      { code: 'match.none', params: {} },
    ]);
    const calendar = entry({ source: 'gcal.event', windowStart: at('16:00'), allCalendars: true });
    const both = buildCoverage([entry(), { ...calendar, windowEnd: EVAL, windowStart: at('14:50') }], EVAL);
    const partial = run(claimOf(), [], both, undefined, NO_CONTEXT, policy);
    expect([partial.ruleId, partial.reasons[0]]).toEqual([
      'partial_coverage',
      { code: 'coverage.partial', params: { source: 'gcal.event' } },
    ]);
  });
});

describe('§3 corrupt duplicates: two rows with one id grade the same in either order', () => {
  it('the row whose canonical JSON sorts first is graded and hashed, whatever the order', () => {
    const real = obsOf();
    const twin = { ...real, subjectHint: 'Unrelated' };
    const first = run(claimOf(), [real, twin]);
    const second = run(claimOf(), [twin, real]);
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    const kept = canonicalJson(real) < canonicalJson(twin) ? real : twin;
    expect(canonicalJson(run(claimOf(), [kept]))).toBe(canonicalJson(first));
  });

  it('a twin observed after evaluatedAt is dropped before de-duplication (its JSON sorts first)', () => {
    const real = obsOf();
    // 15:00:00.001-04:00 written at -08:00: later than evaluatedAt, yet its text sorts before 14:30-04:00.
    const future = { ...real, observedAt: IsoTs.parse('2026-10-06T11:00:00.001-08:00') };
    expect(canonicalJson(future) < canonicalJson(real)).toBe(true);
    const receipt = run(claimOf(), [future, real]);
    expect(receipt.ruleId).toBe('verified');
    expect(canonicalJson(receipt)).toBe(canonicalJson(run(claimOf(), [real])));
  });
});

describe('§3 set-like arrays with non-ASCII members hash as sets (UTF-16 code-unit order)', () => {
  // An astral code point (surrogate pair D83D…) sorts below U+FFFD by code unit, above it by code point.
  const members = ['\u{1F600}.example', '�.example', 'company.com', 'é.example', 'é.example'];
  const scopes = ['\u{1F600}', '�', 'gmail.read', 'é'];

  it('any order and repetition of the allowlist and scopes gives the identical receipt and inputsHash', () => {
    const graded = (allowlist: string[], declared: string[]) =>
      run(
        claimOf(),
        [obsOf()],
        undefined,
        grantOf({ counterpartyAllowlist: allowlist, declaredScopes: declared }),
      );
    const base = graded(members, scopes);
    expect(base.ruleId).toBe('verified');
    const reversed = graded([...members].reverse(), [...scopes, ...scopes].reverse());
    const rotated = graded(
      [...members.slice(2), ...members.slice(0, 2), members[0] ?? ''],
      scopes.slice(1).concat(scopes),
    );
    expect(reversed).toStrictEqual(base);
    expect(rotated).toStrictEqual(base);
  });

  it('a different member (not a reordering) changes inputsHash', () => {
    const graded = (allowlist: string[]) =>
      run(claimOf(), [obsOf()], undefined, grantOf({ counterpartyAllowlist: allowlist })).inputsHash;
    expect(graded(members)).not.toBe(graded(members.map((m) => m.normalize('NFC'))));
  });
});
