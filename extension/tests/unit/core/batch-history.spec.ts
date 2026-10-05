/**
 * The spend history and the cumulative ceiling (docs/grading.md §3, §6.1, §6.3, §7; Hard Rules 5, 6), as golden-style
 * scenarios run through the golden loader and runner (each also replays its receipts with grade(), §9):
 *
 *  - TECH-C13: `gradeBatch` reads `activity.claims` plus every graded claim it omits. Two $30 purchases against a
 *    $50 ceiling make the second OVER_SCOPE (`over_ceiling_cumulative`) whether the caller lists them in
 *    `activity.claims` or not, never counted twice; an omitted graded claim still suppresses adjacency (§7).
 *  - TECH-C3: one meaning of "counted in spendCurrency" (a claim currency absent or equal to it): two currency-less
 *    $30 purchases against a $50 USD ceiling make the second OVER_SCOPE, and so do one in USD and one without.
 */
import { describe, expect, it } from 'vitest';

import { buildScenario } from '../../golden/load';
import { runScenario } from '../../golden/runner';
import { diffScenario } from '../../golden/runner-diff';
import { Scenario } from '../../golden/scenario-schema';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;

/** A 3000-cent purchase from Acme by muse at `hhmm`, in `currency` (or none). */
const purchase = (ref: string, hhmm: string, currency?: string) => ({
  ref,
  agent: 'muse',
  type: 'purchase.made',
  counterparty: 'acme',
  amountCents: 3000,
  ...(currency === undefined ? {} : { currency }),
  claimedAt: at(hhmm),
});

const FIRST = {
  ref: 'c1',
  grade: 'UNVERIFIABLE',
  ruleId: 'no_coverage',
  state: 'PENDING',
  observationRefs: [],
  score: null,
  reasonCodes: ['coverage.none', 'match.none'],
  inputs: { priorSpendCents: 0 },
};
const SECOND_OVER = {
  ref: 'c2',
  grade: 'OVER_SCOPE',
  ruleId: 'over_ceiling_cumulative',
  state: 'FINAL',
  observationRefs: [],
  score: null,
  reasonCodes: ['ceiling.cumulative_exceeded', 'match.none'],
  reasonParams: {
    'ceiling.cumulative_exceeded': { priorSpendCents: 3000, amountCents: 3000, ceilingCents: 5000 },
    'match.none': {},
  },
  inputs: { priorSpendCents: 3000 },
};

/** Two purchases at 10:00 and 11:00, no receipt coverage, a 5000 USD ceiling; `activity.claims` as given. */
function ceilingScenario(
  name: string,
  currencies: readonly [string | undefined, string | undefined],
  listed?: readonly string[],
) {
  return Scenario.parse({
    name,
    covers: ['edge:cumulative_ceiling'],
    mode: 'batch',
    input: {
      evaluatedAt: at('12:00'),
      claims: [purchase('c1', '10:00', currencies[0]), purchase('c2', '11:00', currencies[1])],
      observations: [],
      grants: [{ agent: 'muse', spendCeilingCents: 5000, spendCurrency: 'USD' }],
      coverage: [],
      ...(listed === undefined ? {} : { activity: { claims: listed } }),
    },
    expect: [FIRST, SECOND_OVER],
  });
}

async function problemsOf(scenario: Scenario): Promise<string[]> {
  const loaded = buildScenario('inline-batch-history.json', scenario);
  return diffScenario(loaded, await runScenario(loaded));
}

describe('TECH-C13: graded claims count toward the cumulative ceiling even when activity.claims omits them', () => {
  it.each([
    ['both listed', ['c1', 'c2']],
    ['none listed', []],
    ['only the first listed', ['c1']],
    ['only the second listed', ['c2']],
  ] as const)(
    'two 3000-cent USD purchases, %s: the second is over_ceiling_cumulative, prior 3000',
    async (_, listed) => {
      const scenario = ceilingScenario('cumulative from graded claims', ['USD', 'USD'], listed);
      expect(await problemsOf(scenario)).toEqual([]);
    },
  );
});

describe('TECH-C3: a claim with no currency is counted in spendCurrency, for the Amount and the cumulative sum', () => {
  it.each([
    ['neither has a currency', [undefined, undefined]],
    ['the first in USD, the second without', ['USD', undefined]],
    ['the first without, the second in USD', [undefined, 'USD']],
  ] as const)(
    'two 3000-cent purchases against a 5000-cent USD ceiling, %s: the second is OVER_SCOPE',
    async (_, currencies) => {
      expect(await problemsOf(ceilingScenario('cumulative without a currency', currencies))).toEqual([]);
    },
  );

  it('a claim in another currency is not counted: EUR then a currency-less claim stays under the ceiling', async () => {
    const scenario = Scenario.parse({
      ...ceilingScenario('a foreign currency is not counted', ['EUR', undefined]),
      expect: [
        {
          ...FIRST,
          grade: 'OVER_SCOPE',
          ruleId: 'over_ceiling',
          state: 'FINAL',
          reasonCodes: ['ceiling.currency_mismatch', 'match.none'],
          inputs: { priorSpendCents: 0 },
        },
        { ...FIRST, ref: 'c2', inputs: { priorSpendCents: 0 } },
      ],
    });
    expect(await problemsOf(scenario)).toEqual([]);
  });
});

/** An unclaimed email at 14:03 with a muse session and log entry beside it, and muse's claim to someone else. */
const adjacencyScenario = (listed: readonly string[]) =>
  Scenario.parse({
    name: 'adjacency suppressed by a graded claim',
    covers: ['edge:adjacency_suppressed'],
    mode: 'batch',
    input: {
      evaluatedAt: at('15:00'),
      claims: [
        {
          ref: 'c1',
          agent: 'muse',
          type: 'email.sent',
          counterparty: 'raj@other.org',
          claimedAt: at('14:03'),
        },
      ],
      observations: [
        {
          ref: 'o1',
          source: 'gmail.sent',
          type: 'email.sent',
          counterparty: 'priya@company.com',
          occurredAt: at('14:03'),
          observedAt: at('14:30'),
        },
      ],
      grants: [{ agent: 'muse' }],
      coverage: [
        {
          source: 'gmail.sent',
          lastSyncAt: at('15:00'),
          windowStart: at('12:00'),
          windowEnd: at('15:00'),
          accountHash: 'acct-a',
        },
      ],
      activity: {
        sessions: [{ agent: 'muse', at: at('14:03') }],
        entries: [{ agent: 'muse', at: at('14:03') }],
        claims: listed,
      },
    },
    expect: [
      {
        ref: 'c1',
        grade: 'NOT_FOUND',
        ruleId: 'not_found',
        state: 'FINAL',
        observationRefs: [],
        // raj@other.org × priya@company.com matches on time alone: 0 by the §5.3 content gate (v1.11; was 1/3).
        score: '0/1',
        reasonCodes: ['coverage.account_unbound', 'match.best'],
      },
    ],
  });

describe('TECH-C13: an omitted graded claim still suppresses activity-log adjacency (§7)', () => {
  it.each([
    ['listed', ['c1']],
    ['omitted', []],
  ] as const)('the claim %s in activity.claims: no UNASKED receipt for the email', async (_, listed) => {
    expect(await problemsOf(adjacencyScenario(listed))).toEqual([]);
  });
});
