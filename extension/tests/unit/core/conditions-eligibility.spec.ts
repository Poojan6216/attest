/**
 * Coverage eligibility edges no other test pinned (docs/grading.md §3, §6.1; QA Sprint 1 review, mutation probes):
 *
 *  - The receipt-parser test reads the claim's counterparty through `name()` (§6.1: "whose normalised counterparty
 *    (`name()`, §11) is not in `policy.receiptMerchants`"). Every earlier case used `ACME`, where `name()` and a
 *    plain lowercase agree, so replacing `name()` with `toLowerCase()` survived the suite. Here the two differ
 *    (fullwidth, diacritics, spacing, invisible marks), and text that reads differently from how it displays has
 *    no parser at all.
 *  - The account-hash count behind `coverage.multiple_accounts` reads only entries synced by `evaluatedAt` (§3:
 *    "coverage entries with `lastSyncAt > evaluatedAt` … are ignored"). Counting a later entry's account survived
 *    the suite, because `grade()` filters coverage before eligibility; the exported `coverageLevel` (§13) does not.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { coverageLevel } from '../../../src/core/conditions';
import { grade } from '../../../src/core/grade';
import { loadPolicy, type Policy } from '../../../src/core/policy';
import { Claim, type Coverage, Receipt } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, mergePatch } from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage } from '../../golden/scenario-schema';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const GRANT = buildGrant({ agent: 'muse' }, EVAL);
const PARSERS: Policy = loadPolicy(
  mergePatch(defaultPolicyJson, { receiptMerchants: ['acme', 'corner shop', 'cafe'] }),
);

function claimOf(over: Record<string, unknown>): Claim {
  const base = { ref: 'c1', agent: 'muse', claimedAt: at('14:02'), ...over };
  return buildClaim(ScenarioClaim.parse(base));
}

const purchase = (counterparty: string): Claim =>
  claimOf({ type: 'purchase.made', counterparty, amountCents: 3_000, currency: 'USD' });

const entry = (over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gmail.receipt',
  lastSyncAt: EVAL,
  windowStart: at('12:00'),
  windowEnd: EVAL,
  accountHash: 'acct-a',
  ...over,
});

const coverageOf = (entries: readonly ScenarioCoverage[]): Coverage => buildCoverage(entries, EVAL);

describe('§6.1: a purchase has a receipt parser iff name() of its counterparty is listed', () => {
  it.each([
    ['fullwidth letters', 'ＡＣＭＥ'],
    ['a diacritic', 'Café'],
    ['a decomposed diacritic', 'Cafe\u0301'],
    ['runs of spaces and a no-break space', '  Corner \u00A0  Shop '],
    ['a zero-width space inside', 'Ac\u200Bme'],
  ])('%s: full coverage, no no_parser cap', (_label, counterparty) => {
    const result = coverageLevel(purchase(counterparty), GRANT, coverageOf([entry()]), PARSERS);
    expect(result.level).toBe('full');
    expect(result.capReasons).toEqual([]);
  });

  it.each([
    ['a right-to-left override (shows "acme", stores "emca")', '\u202Eemca'],
    ['a different merchant', 'Acme Store'],
    ['letters split by spaces', 'A C M E'],
  ])('%s: capped at partial with coverage.no_parser', (_label, counterparty) => {
    const result = coverageLevel(purchase(counterparty), GRANT, coverageOf([entry()]), PARSERS);
    expect(result.level).toBe('partial');
    expect(result.capReasons).toEqual([{ code: 'coverage.no_parser', source: 'gmail.receipt' }]);
  });

  it('a tab never reaches name(): the Claim schema refuses it, while a no-break space is one line (SEC-3)', () => {
    // A counterparty is one line (src/core/schema-text.ts): \p{Cc} (tab included) is refused at the boundary,
    // so the whitespace name() collapses in a stored claim is spaces and Zs separators such as U+00A0.
    const valid = purchase('Corner Shop');
    expect(Claim.safeParse({ ...valid, counterparty: '  Corner \t  Shop ' }).success).toBe(false);
    expect(Claim.safeParse({ ...valid, counterparty: '  Corner \u00A0  Shop ' }).success).toBe(true);
  });

  it('decides NOT_FOUND against partial_coverage for a purchase nobody saw (Hard Rule 5)', () => {
    const covered = coverageOf([entry()]);
    const graded = (counterparty: string) =>
      Receipt.parse(grade(purchase(counterparty), [], GRANT, PARSERS, covered, { priorSpendCents: 0 }));
    expect(graded('Café').ruleId).toBe('not_found');
    expect(graded('\u202Eemca').ruleId).toBe('partial_coverage');
  });
});

describe('§3, §6.1: the account count reads only entries synced by evaluatedAt', () => {
  const email = claimOf({ type: 'email.sent', counterparty: 'priya@company.com' });
  const seen = entry({ source: 'gmail.sent' });
  const later = entry({
    source: 'gmail.sent',
    accountHash: 'acct-b',
    lastSyncAt: '2026-10-06T15:00:00.001-04:00',
  });

  it('a second account synced after evaluatedAt does not cap the first (no multiple_accounts)', () => {
    const result = coverageLevel(email, GRANT, coverageOf([seen, later]), PARSERS);
    expect(result.level).toBe('full');
    expect(result.capReasons).toEqual([]);
  });

  it('the same second account synced by evaluatedAt caps both entries', () => {
    const now = { ...later, lastSyncAt: EVAL };
    const result = coverageLevel(email, GRANT, coverageOf([seen, now]), PARSERS);
    expect(result.level).toBe('partial');
    expect(result.capReasons).toEqual([{ code: 'coverage.multiple_accounts', source: 'gmail.sent' }]);
  });

  it('grade() agrees: not_found with the later entry, partial_coverage with both synced', () => {
    const graded = (coverage: Coverage) =>
      Receipt.parse(grade(email, [], GRANT, PARSERS, coverage, { priorSpendCents: 0 })).ruleId;
    expect(graded(coverageOf([seen, later]))).toBe('not_found');
    expect(graded(coverageOf([seen, { ...later, lastSyncAt: EVAL }]))).toBe('partial_coverage');
  });
});
