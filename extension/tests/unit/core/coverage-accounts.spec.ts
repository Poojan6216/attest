/**
 * Per-account coverage (docs/grading.md v1.11 §6.1; Sprint 2 wave E decision b; the Calendar simulator's CAL-SIM-4):
 * when `grant.accounts[source]` binds two or more distinct accounts, one account's view never vouches for another's.
 * The source is full only when each bound account's own eligible, uncapped entries contain the claim window; a window
 * only their union contains is `partial` with `coverage.account_partial` {source}, which a `partial_coverage`
 * receipt names. Every source alike. One bound account, a list naming one account twice, and an unbound grant (the
 * `coverage.multiple_accounts` cap) are as before.
 *
 * Times are 2026-10-06 in −04:00 unless a day is given; evaluatedAt 10:00.
 */
import { describe, expect, it } from 'vitest';

import { coverageLevel } from '../../../src/core/conditions';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { reasonText } from '../../../src/core/reason-text';
import type { Claim, ObservationSource } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant } from '../../golden/build';
import { ScenarioClaim, type ScenarioCoverage } from '../../golden/scenario-schema';

const EVAL = '2026-10-06T10:00:00-04:00';
const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;

/** A created claim at 09:00 for Wed 10-07 13:00: window [10-04 13:00, 10-10 13:00], grace sync 09:31. */
const created: Claim = buildClaim(
  ScenarioClaim.parse({
    ref: 'c1',
    agent: 'muse',
    type: 'calendar.created',
    subjectHint: 'Board prep',
    claimedAt: at('09:00'),
    targetAt: at('13:00', '07'),
  }),
);
/** An email claim at 07:32: window [07:30, 08:18]. */
const sent: Claim = buildClaim(
  ScenarioClaim.parse({
    ref: 'c2',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    claimedAt: at('07:32'),
  }),
);

const week = (account: string, over: Partial<ScenarioCoverage> = {}): ScenarioCoverage => ({
  source: 'gcal.event',
  lastSyncAt: at('09:50'),
  windowStart: at('00:00', '04'),
  windowEnd: at('00:00', '11'),
  accountHash: account,
  allCalendars: true,
  changesSince: at('08:00'),
  ...over,
});
const head = (account: string, from: string): ScenarioCoverage => ({
  source: 'gmail.sent',
  lastSyncAt: at('10:00'),
  windowStart: at(from),
  windowEnd: at('10:00'),
  accountHash: account,
});

const bound = (source: ObservationSource, accounts: readonly string[]) =>
  buildGrant({ agent: 'muse', accounts: { [source]: [...accounts] } }, EVAL);
const level = (claim: Claim, accounts: readonly string[], entries: readonly ScenarioCoverage[]) =>
  coverageLevel(
    claim,
    bound(claim.type === 'email.sent' ? 'gmail.sent' : 'gcal.event', accounts),
    buildCoverage(entries, EVAL),
    DEFAULT_POLICY,
  );
const pieced = (source: ObservationSource) => ({
  level: 'partial',
  capReasons: [{ code: 'coverage.account_partial', source }],
});

describe('one bound account never vouches for another (§6.1 v1.11)', () => {
  it("CAL-SIM-4: acct-b's whole view, nothing of acct-a's → partial, coverage.account_partial", () => {
    expect(level(created, ['acct-a', 'acct-b'], [week('acct-b')])).toMatchObject(pieced('gcal.event'));
    // acct-a's view of the other week does not hold the window either.
    const otherWeek = week('acct-a', { windowStart: at('00:00', '11'), windowEnd: at('00:00', '18') });
    expect(level(created, ['acct-a', 'acct-b'], [week('acct-b'), otherWeek])).toMatchObject(
      pieced('gcal.event'),
    );
  });

  it('is full once each bound account is seen whole, in any order of the bound list', () => {
    const both = [week('acct-b'), week('acct-a')];
    expect(level(created, ['acct-a', 'acct-b'], both)).toMatchObject({ level: 'full', capReasons: [] });
    expect(level(created, ['acct-b', 'acct-a'], both).level).toBe('full');
  });

  it('pieces neither one account from parts of two, nor the window from two accounts', () => {
    const early = week('acct-a', { windowEnd: at('00:00', '08') });
    const late = week('acct-b', { windowStart: at('00:00', '08') });
    expect(level(created, ['acct-a', 'acct-b'], [early, late])).toMatchObject(pieced('gcal.event'));
    // Two views of acct-a that touch still make acct-a whole.
    const lateA = week('acct-a', { windowStart: at('00:00', '08') });
    expect(level(created, ['acct-a', 'acct-b'], [early, lateA, week('acct-b')]).level).toBe('full');
  });

  it('adds no account_partial where the union is not whole either', () => {
    const early = week('acct-a', { windowEnd: at('00:00', '06') });
    expect(level(created, ['acct-a', 'acct-b'], [early])).toMatchObject({ level: 'partial', capReasons: [] });
  });

  it('applies to Gmail Sent: acct-b seen only from 08:00 cannot vouch for 07:30', () => {
    const entries = [head('acct-a', '07:00'), head('acct-b', '08:00')];
    expect(level(sent, ['acct-a', 'acct-b'], entries)).toMatchObject(pieced('gmail.sent'));
    expect(level(sent, ['acct-a', 'acct-b'], [head('acct-a', '07:00'), head('acct-b', '07:30')]).level).toBe(
      'full',
    );
  });

  it('changes nothing for one bound account, or one named twice', () => {
    expect(level(created, ['acct-b'], [week('acct-b')])).toMatchObject({ level: 'full', capReasons: [] });
    expect(level(created, ['acct-b', 'acct-b'], [week('acct-b')])).toMatchObject({
      level: 'full',
      capReasons: [],
    });
  });
});

describe('the account_partial reason on a receipt (§15)', () => {
  it('is named by partial_coverage, never NOT_FOUND, and its text names the service', () => {
    const grant = bound('gcal.event', ['acct-a', 'acct-b']);
    const receipt = grade(created, [], grant, DEFAULT_POLICY, buildCoverage([week('acct-b')], EVAL), {
      priorSpendCents: 0,
    });
    expect([receipt.grade, receipt.ruleId, receipt.state]).toEqual([
      'UNVERIFIABLE',
      'partial_coverage',
      'PENDING',
    ]);
    expect(receipt.reasons).toEqual([
      { code: 'coverage.partial', params: { source: 'gcal.event' } },
      { code: 'coverage.account_partial', params: { source: 'gcal.event' } },
      { code: 'match.none', params: {} },
    ]);
    expect(reasonText({ code: 'coverage.account_partial', params: { source: 'gcal.event' } })).toBe(
      "Attest did not see this claim's whole time window in every Google Calendar account set for this agent.",
    );
  });
});
