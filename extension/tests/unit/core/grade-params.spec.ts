/**
 * Reason params per docs/grading.md §15 (v1.4), through `grade()`:
 *  - `ceiling.currency_mismatch` {currency: the claim's currency when present and ≠ spendCurrency, else the
 *    assigned candidate's; spendCurrency};
 *  - `coverage.no_parser` {source}, like every other coverage-capping code;
 *  - numeric params are non-negative integers (`-0` is written `0`).
 * The schema enforces the closed table; these tests pin which value each param takes.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import {
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
import { ScenarioClaim, ScenarioCoverage, ScenarioObservation } from '../../golden/scenario-schema';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const VIEW = PolicyView.parse(defaultPolicyJson);
const CEILING = buildGrant({ agent: 'muse', spendCeilingCents: 5_000, spendCurrency: 'USD' }, EVAL);

const without = (value: Record<string, unknown>, omit: readonly string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)));

/** A purchase of `acme` at 14:02 (`currency: null` leaves the currency out). */
function purchase(amountCents: number, currency: string | null): Claim {
  const base = {
    ref: 'c1',
    agent: 'muse',
    type: 'purchase.made',
    counterparty: 'acme',
    amountCents,
    currency,
  };
  return buildClaim(
    ScenarioClaim.parse(without({ ...base, claimedAt: at('14:02') }, currency ? [] : ['currency'])),
  );
}

/** An Acme receipt email at 14:02: assigned to `purchase` (time and merchant match, 9/14 ≥ partial). */
function receipt(amountCents: number, currency: string | null): Observation {
  const base = {
    ref: 'o1',
    source: 'gmail.receipt',
    type: 'purchase.made',
    merchant: 'Acme',
    amountCents,
    currency,
    occurredAt: at('14:02'),
    observedAt: at('14:30'),
  };
  return buildObservation(
    ScenarioObservation.parse(without(base, currency ? [] : ['currency'])),
    [],
    EVAL,
    VIEW,
  );
}

const entry = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gmail.receipt',
  lastSyncAt: EVAL,
  windowStart: at('12:00'),
  windowEnd: EVAL,
  accountHash: 'acct-a',
  ...over,
});

function run(
  claim: Claim,
  candidates: readonly Observation[],
  coverage: readonly ScenarioCoverage[] = [],
  grant: Grant = CEILING,
  context: GradeContext = { priorSpendCents: 0 },
): Receipt {
  return Receipt.parse(
    grade(claim, candidates, grant, DEFAULT_POLICY, buildCoverage(coverage, EVAL), context),
  );
}

const paramsOf = (r: Receipt, code: string) => r.reasons.find((reason) => reason.code === code)?.params;

describe('§15 ceiling.currency_mismatch: the claim’s currency first, else the assigned candidate’s', () => {
  it.each([
    ['the claim in EUR, the receipt in CAD', purchase(3_000, 'EUR'), [receipt(3_000, 'CAD')], 'EUR'],
    ['the claim in EUR, the receipt in USD', purchase(3_000, 'EUR'), [receipt(3_000, 'USD')], 'EUR'],
    ['the claim in EUR, no receipt', purchase(3_000, 'EUR'), [], 'EUR'],
    ['the claim in USD, the receipt in CAD', purchase(3_000, 'USD'), [receipt(3_000, 'CAD')], 'CAD'],
    [
      'the claim without a currency, the receipt in CAD',
      purchase(3_000, null),
      [receipt(3_000, 'CAD')],
      'CAD',
    ],
  ])('%s: currency %s', (_, claim, candidates, currency) => {
    const r = run(claim, candidates);
    expect([r.grade, r.ruleId]).toEqual(['OVER_SCOPE', 'over_ceiling']);
    expect(paramsOf(r, 'ceiling.currency_mismatch')).toEqual({ currency, spendCurrency: 'USD' });
  });

  it('no mismatch when both are in spendCurrency, or the receipt has no currency', () => {
    for (const candidates of [[receipt(3_000, 'USD')], [receipt(3_000, null)], []]) {
      const r = run(purchase(3_000, 'USD'), candidates);
      expect(paramsOf(r, 'ceiling.currency_mismatch')).toBeUndefined();
      expect(r.grade).not.toBe('OVER_SCOPE');
    }
  });
});

describe('§15 coverage.no_parser names its source', () => {
  it('{source: gmail.receipt}, alone or beside another cap (each cap with its own source)', () => {
    const alone = run(purchase(3_000, 'USD'), [], [entry()]);
    expect(alone.ruleId).toBe('partial_coverage');
    expect(paramsOf(alone, 'coverage.no_parser')).toEqual({ source: 'gmail.receipt' });
    const unhashed = ScenarioCoverage.parse(without(entry(), ['accountHash']));
    const both = run(purchase(3_000, 'USD'), [], [unhashed]);
    expect(both.reasons.filter((r) => r.code.startsWith('coverage.'))).toEqual([
      { code: 'coverage.partial', params: { source: 'gmail.receipt' } },
      { code: 'coverage.no_account', params: { source: 'gmail.receipt' } },
      { code: 'coverage.no_parser', params: { source: 'gmail.receipt' } },
    ]);
  });
});

describe('coverage.no_parser for a type with several sources, one of them gmail.receipt', () => {
  it('the receipt entries stay capped for a merchant with no parser, so the claim is never NOT_FOUND', () => {
    // §6.1 names the cap for a purchase-like type (sources exactly ["gmail.receipt"]); Decisions [1.5] applies it
    // to every type that reads receipts, because a gmail.receipt interval vouches only for parsed merchants (§3).
    const sources = { sourcesByType: { 'purchase.made': ['gmail.receipt', 'gmail.sent'] } };
    const both = buildCoverage([entry(), entry({ source: 'gmail.sent' })], EVAL);
    const graded = (patch: Record<string, unknown>) =>
      Receipt.parse(
        grade(purchase(3_000, 'USD'), [], CEILING, loadPolicy(mergePatch(defaultPolicyJson, patch)), both, {
          priorSpendCents: 0,
        }),
      );
    const unparsed = graded(sources);
    expect([unparsed.ruleId, unparsed.reasons]).toEqual([
      'partial_coverage',
      [
        { code: 'coverage.partial', params: { source: 'gmail.receipt' } },
        { code: 'coverage.no_parser', params: { source: 'gmail.receipt' } },
        { code: 'match.none', params: {} },
      ],
    ]);
    expect(graded({ ...sources, receiptMerchants: ['acme'] }).ruleId).toBe('not_found');
  });
});

describe('§15 numeric params are non-negative integers (-0 is written 0)', () => {
  const numbers = (r: Receipt): number[] =>
    r.reasons.flatMap((reason) =>
      Object.values(reason.params).filter((v): v is number => typeof v === 'number'),
    );

  it.each([
    ['an amount over the ceiling', run(purchase(8_000, 'USD'), [])],
    ['the assigned receipt over the ceiling', run(purchase(3_000, 'USD'), [receipt(9_000, 'USD')])],
    ['a cumulative overrun', run(purchase(3_000, 'USD'), [], [], CEILING, { priorSpendCents: 4_000 })],
    [
      'a zero ceiling and a -0 prior spend',
      run(
        purchase(1, 'USD'),
        [],
        [],
        buildGrant({ agent: 'muse', spendCeilingCents: 0, spendCurrency: 'USD' }, EVAL),
        { priorSpendCents: -0 },
      ),
    ],
    [
      'a -0 amount over a -0 cumulative',
      run(
        purchase(-0, 'USD'),
        [],
        [],
        buildGrant({ agent: 'muse', spendCeilingCents: -0, spendCurrency: 'USD' }, EVAL),
        { priorSpendCents: 1 },
      ),
    ],
  ])('%s', (_, r) => {
    const values = numbers(r);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Object.is(value, -0)).toBe(false);
    }
  });
});
