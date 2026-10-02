/**
 * Task 1.5: coverage eligibility, coverage level and grace (docs/grading.md §6.1), and the rule evaluator
 * (not applicable vs true/false, claim-less evaluation, first match wins).
 *
 * The email claim used throughout is at 14:02 (minute precision): unit [14:02, 14:03], window [14:00, 14:48];
 * grace needs a sync ≥ 14:33 (end + graceMin) and ≥ 14:48 (end + afterClaimMin).
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import {
  candidateDependent,
  coverageLevel,
  EVALUATED_CONDITIONS,
  evaluateConditions,
  firstMatch,
  graceElapsed,
  ruleMatches,
} from '../../../src/core/conditions';
import { ConditionName, DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { ratio } from '../../../src/core/ratio';
import {
  Attribution,
  type Claim,
  type Coverage,
  type GradeContext,
  type Grant,
} from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, mergePatch } from '../../golden/build';
import { ScenarioClaim, ScenarioCoverage, type ScenarioGrant } from '../../golden/scenario-schema';

const EVAL = '2026-10-06T15:00:00-04:00';
const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;

function claimOf(over: Record<string, unknown> = {}, omit: readonly string[] = []): Claim {
  const base: Record<string, unknown> = {
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 deck',
    claimedAt: at('14:02'),
    ...over,
  };
  return buildClaim(
    ScenarioClaim.parse(Object.fromEntries(Object.entries(base).filter(([k]) => !omit.includes(k)))),
  );
}

const entry = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gmail.sent',
  lastSyncAt: at('15:00'),
  windowStart: at('12:00'),
  windowEnd: at('15:00'),
  accountHash: 'acct-a',
  ...over,
});
/** An entry with no account hash (capped at partial without a grant binding). */
const unhashed = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage =>
  ScenarioCoverage.parse(
    Object.fromEntries(Object.entries(entry(over)).filter(([key]) => key !== 'accountHash')),
  );
const coverageOf = (entries: readonly ScenarioCoverage[], evaluatedAt = EVAL): Coverage =>
  buildCoverage(entries, evaluatedAt);
const grantOf = (over: Partial<ScenarioGrant> = {}): Grant => buildGrant({ agent: 'muse', ...over }, EVAL);
const policyWith = (patch: Record<string, unknown>): Policy =>
  loadPolicy(mergePatch(defaultPolicyJson, patch));

const level = (
  claim: Claim,
  entries: readonly ScenarioCoverage[],
  grant = grantOf(),
  policy = DEFAULT_POLICY,
) => coverageLevel(claim, grant, coverageOf(entries), policy);

describe('coverage: the union of eligible uncapped intervals (§6.1)', () => {
  const claim = claimOf();

  it('full when one interval contains the window, none when nothing overlaps', () => {
    expect(level(claim, [entry()])).toMatchObject({ level: 'full', capReasons: [] });
    expect(level(claim, [])).toMatchObject({ level: 'none', capReasons: [] });
    expect(level(claim, [entry({ windowStart: at('15:00'), windowEnd: at('15:00') })]).level).toBe('none');
  });

  it('partial when an interval overlaps but leaves a gap, even of 1 ms', () => {
    expect(level(claim, [entry({ windowStart: at('14:10') })]).level).toBe('partial');
    const left = entry({ windowEnd: at('14:20') });
    const touching = entry({ windowStart: at('14:20') });
    const gapped = entry({ windowStart: '2026-10-06T14:20:00.001-04:00' });
    expect(level(claim, [left, touching]).level).toBe('full');
    expect(level(claim, [left, gapped]).level).toBe('partial');
  });

  it('closed intervals: touching the window edge at one instant overlaps; 1 ms short does not', () => {
    expect(level(claim, [entry({ windowStart: at('12:00'), windowEnd: at('14:00') })]).level).toBe('partial');
    const short = entry({ windowStart: at('12:00'), windowEnd: '2026-10-06T13:59:59.999-04:00' });
    expect(level(claim, [short]).level).toBe('none');
    expect(level(claim, [entry({ windowStart: at('14:00'), windowEnd: at('14:48') })]).level).toBe('full');
  });

  it('ignores an entry synced after evaluatedAt (§3)', () => {
    expect(level(claim, [entry({ lastSyncAt: '2026-10-06T15:00:00.001-04:00' })]).level).toBe('none');
  });

  it('caps an entry with no account hash (coverage.no_account)', () => {
    const capped = level(claim, [unhashed()]);
    expect(capped).toMatchObject({
      level: 'partial',
      capReasons: [{ code: 'coverage.no_account', source: 'gmail.sent' }],
    });
  });

  it('caps every entry of a source seen with two accounts (coverage.multiple_accounts)', () => {
    const result = level(claim, [entry(), entry({ accountHash: 'acct-b' })]);
    expect(result).toMatchObject({ level: 'partial', capReasons: [{ code: 'coverage.multiple_accounts' }] });
  });

  it('counts accounts over every entry of the source, not only those overlapping the window', () => {
    const elsewhere = entry({ accountHash: 'acct-b', windowStart: at('08:00'), windowEnd: at('09:00') });
    expect(level(claim, [entry(), elsewhere]).level).toBe('partial');
  });

  it('a grant.accounts binding admits only its accounts and lifts the account caps', () => {
    const bound = grantOf({ accounts: { 'gmail.sent': ['acct-a'] } });
    expect(level(claim, [entry({ accountHash: 'acct-b' })], bound).level).toBe('none');
    expect(level(claim, [entry(), entry({ accountHash: 'acct-b' })], bound).level).toBe('full');
    expect(level(claim, [unhashed()], bound).level).toBe('none');
  });
});

describe('coverage: caps and several sources (§6.1)', () => {
  const claim = claimOf();

  it('caps a calendar view that does not show every calendar (coverage.calendars_hidden)', () => {
    const calendar = claimOf({ type: 'calendar.created', targetAt: at('14:00', '08') });
    const view = {
      source: 'gcal.event' as const,
      windowStart: at('00:00', '01'),
      windowEnd: at('00:00', '20'),
    };
    expect(level(calendar, [entry(view)])).toMatchObject({
      level: 'partial',
      capReasons: [{ code: 'coverage.calendars_hidden', source: 'gcal.event' }],
    });
    expect(level(calendar, [entry({ ...view, allCalendars: true })]).level).toBe('full');
  });

  it('caps receipts for a purchase whose normalised merchant has no parser (coverage.no_parser, v1.3)', () => {
    const receipt = entry({ source: 'gmail.receipt' });
    const purchase = claimOf({
      type: 'purchase.made',
      counterparty: 'ACME',
      amountCents: 3000,
      currency: 'USD',
    });
    expect(level(purchase, [receipt]).capReasons).toEqual([
      { code: 'coverage.no_parser', source: 'gmail.receipt' },
    ]);
    const parsed = policyWith({ receiptMerchants: ['acme'] });
    expect(level(purchase, [receipt], grantOf(), parsed).level).toBe('full');
    const anonymous = claimOf({ type: 'purchase.made', amountCents: 3000, currency: 'USD' }, [
      'counterparty',
    ]);
    expect(level(anonymous, [receipt], grantOf(), parsed).level).toBe('partial');
  });

  it('a type with no sources, and a calendar claim with no target, have no coverage', () => {
    expect(level(claimOf({ type: 'message.sent' }), [entry()])).toMatchObject({ level: 'none', sources: [] });
    const noTarget = claimOf({ type: 'calendar.created' });
    expect(level(noTarget, [entry({ source: 'gcal.event', allCalendars: true })]).level).toBe('none');
  });

  it('several sources: full only if every one is full, none only if every one is none', () => {
    const policy = policyWith({ sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } });
    const calendar = entry({ source: 'gcal.event', allCalendars: true });
    expect(level(claim, [entry()], grantOf(), policy).level).toBe('partial');
    expect(level(claim, [entry(), calendar], grantOf(), policy).level).toBe('full');
    expect(level(claim, [], grantOf(), policy).level).toBe('none');
    const hidden = level(claim, [unhashed(), entry({ source: 'gcal.event' })], grantOf(), policy);
    expect(hidden.capReasons).toEqual([
      { code: 'coverage.calendars_hidden', source: 'gcal.event' },
      { code: 'coverage.no_account', source: 'gmail.sent' },
    ]);
  });
});

describe('graceElapsed: the observers synced after the whole window could have happened (§6.1)', () => {
  const grace = (claim: Claim, entries: readonly ScenarioCoverage[], grant = grantOf()) =>
    graceElapsed(claim, grant, coverageOf(entries), DEFAULT_POLICY);

  it('non-calendar: needs a sync ≥ end + afterClaimMin (14:48), inclusive', () => {
    expect(grace(claimOf(), [entry({ lastSyncAt: at('14:48') })])).toBe(true);
    expect(grace(claimOf(), [entry({ lastSyncAt: '2026-10-06T14:47:59.999-04:00' })])).toBe(false);
    expect(grace(claimOf(), [])).toBe(false);
  });

  it('calendar: end + graceMin is enough (14:33)', () => {
    const calendar = claimOf({ type: 'calendar.created', targetAt: at('14:00', '08') });
    const synced = (lastSyncAt: string) => entry({ source: 'gcal.event', allCalendars: true, lastSyncAt });
    expect(grace(calendar, [synced(at('14:33'))])).toBe(true);
    expect(grace(calendar, [synced('2026-10-06T14:32:59.999-04:00')])).toBe(false);
  });

  it('a capped entry proves the sync; an entry of an unbound account or synced in the future does not', () => {
    expect(grace(claimOf(), [unhashed()])).toBe(true);
    const bound = grantOf({ accounts: { 'gmail.sent': ['acct-b'] } });
    expect(grace(claimOf(), [entry()], bound)).toBe(false);
    expect(grace(claimOf(), [entry({ lastSyncAt: '2026-10-06T15:00:00.001-04:00' })])).toBe(false);
  });

  it('is vacuously true for a type with no sources', () => {
    expect(grace(claimOf({ type: 'other' }), [])).toBe(true);
  });

  it('with several sources, every one must have synced', () => {
    const policy = policyWith({ sourcesByType: { 'email.sent': ['gmail.sent', 'gcal.event'] } });
    const c = coverageOf([entry()]);
    expect(graceElapsed(claimOf(), grantOf(), c, policy)).toBe(false);
    const both = coverageOf([entry(), entry({ source: 'gcal.event', allCalendars: true })]);
    expect(graceElapsed(claimOf(), grantOf(), both, policy)).toBe(true);
  });
});

describe('evaluators: not applicable vs true/false (§6.1)', () => {
  const coverage = coverageOf([entry()]);
  const facts = (claim: Claim | null, context: GradeContext = { priorSpendCents: 0 }) => ({
    claim,
    grant: grantOf(),
    policy: DEFAULT_POLICY,
    coverage,
    context,
    bestScore: null,
    assigned: null,
  });
  const attribution = (scoreBp: number) =>
    Attribution.parse({ agent: 'muse', scoreBp, signals: ['agentSessionActive'] });

  it('claim-less: only unaskedLikely and observedScopeExceedsDeclared apply', () => {
    const c = evaluateConditions(facts(null, { priorSpendCents: 0, attribution: attribution(6000) }));
    expect([
      c.typeNotInGrant(),
      c.counterpartyNotAllowed(),
      c.amountAboveCeiling(),
      c.cumulativeAboveCeiling(),
    ]).toEqual([null, null, null, null]);
    expect([c.targetMissing(), c.underspecified(), c.coverage(), c.graceElapsed()]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect([c.bestScoreGte('partial'), c.bestScoreLt('partial')]).toEqual([null, null]);
    expect(c.unaskedLikely()).toBe(true);
    expect(c.observedScopeExceedsDeclared()).toBeNull();
  });

  it('unaskedLikely compares basis points exactly at the threshold', () => {
    const likely = (bp: number) =>
      evaluateConditions(facts(null, { priorSpendCents: 0, attribution: attribution(bp) }));
    expect(likely(DEFAULT_POLICY.bp.unasked.threshold).unaskedLikely()).toBe(true);
    expect(likely(DEFAULT_POLICY.bp.unasked.threshold - 1).unaskedLikely()).toBe(false);
    expect(evaluateConditions(facts(null)).unaskedLikely()).toBeNull();
  });

  it('with a claim: the claim-less conditions are not applicable, whatever the context', () => {
    const context = { priorSpendCents: 0, attribution: attribution(9000), scope: { observed: 'gmail.read' } };
    const c = evaluateConditions(facts(claimOf(), context));
    expect([c.unaskedLikely(), c.observedScopeExceedsDeclared()]).toEqual([null, null]);
    expect([c.typeNotInGrant(), c.targetMissing(), c.underspecified()]).toEqual([false, false, false]);
    expect(c.coverage()?.level).toBe('full');
    expect(c.graceElapsed()).toEqual([{ source: 'gmail.sent', elapsed: true }]);
  });

  it('bestScoreGte / bestScoreLt: exact at the threshold; with no candidate Gte is false and Lt true', () => {
    const scored = (num: number, den: number) =>
      evaluateConditions({ ...facts(claimOf()), bestScore: ratio(num, den) });
    expect(scored(17, 20).bestScoreGte('verified')).toBe(true);
    expect(scored(8499, 10000).bestScoreGte('verified')).toBe(false);
    expect(scored(8499, 10000).bestScoreLt('verified')).toBe(true);
    const none = evaluateConditions(facts(claimOf()));
    expect([none.bestScoreGte('partial'), none.bestScoreLt('partial')]).toEqual([false, true]);
  });
});

describe('rules: all conditions must hold and be applicable; first match wins (§6)', () => {
  const c = (claim: Claim | null) =>
    evaluateConditions({
      claim,
      grant: grantOf(),
      policy: DEFAULT_POLICY,
      coverage: coverageOf([entry()]),
      context: { priorSpendCents: 0 },
      bestScore: null,
      assigned: null,
    });

  it('a condition written false still needs to be applicable', () => {
    expect(ruleMatches({ typeNotInGrant: false }, c(claimOf()))).toBe(true);
    expect(ruleMatches({ typeNotInGrant: false }, c(null))).toBe(false);
    expect(ruleMatches({ unaskedLikely: false }, c(null))).toBe(false);
  });

  it('every named condition must hold', () => {
    const claim = c(claimOf());
    expect(ruleMatches({ coverage: 'full', graceElapsed: true, bestScoreLt: 'partial' }, claim)).toBe(true);
    expect(ruleMatches({ coverage: 'full', graceElapsed: false }, claim)).toBe(false);
    expect(ruleMatches({ coverage: 'partial' }, claim)).toBe(false);
  });

  it('firstMatch returns the first matching rule in policy order, or null (terminal rule)', () => {
    expect(firstMatch(DEFAULT_POLICY.rules, c(claimOf()))?.id).toBe('not_found');
    expect(firstMatch(DEFAULT_POLICY.rules, c(null))).toBeNull();
    const twoMatch = [
      { id: 'first', when: { graceElapsed: true }, then: 'NOT_FOUND' as const },
      { id: 'second', when: { coverage: 'full' as const }, then: 'NOT_FOUND' as const },
    ];
    expect(firstMatch(twoMatch, c(claimOf()))?.id).toBe('first');
  });

  it('evaluates exactly the conditions the policy can name', () => {
    expect([...EVALUATED_CONDITIONS].sort()).toEqual([...ConditionName.options].sort());
  });

  it('candidateDependent: score conditions always; allowlist and ceiling only when the candidate decided', () => {
    const claim = c(claimOf());
    expect(candidateDependent({ bestScoreGte: 'partial', typeNotInGrant: true }, claim)).toBe(true);
    expect(candidateDependent({ typeNotInGrant: true }, claim)).toBe(false);
    expect(candidateDependent({ counterpartyNotAllowed: true }, claim)).toBe(false);
    expect(candidateDependent({ amountAboveCeiling: true }, claim)).toBe(false);
  });
});
