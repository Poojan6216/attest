import 'fake-indexeddb/auto';
/**
 * The weekly digest the ledger builds (sprint_4 4.7; src/ledger/digest.ts) from a seeded week: each agent's FINAL
 * receipts by grade, still checking, marked, and verified of checked; the notable receipts newest first, each with a
 * domain only (an address gives its domain, a name none), its amount and subject hint; the days each source's windows
 * never reached; the readers' health. Superseded receipts and receipts of other weeks count nowhere. A week made again
 * replaces itself, and the weeks list newest first. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isoWithLocalOffset } from '../../../src/clock';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { buildDigest, digestWeeks, domainOf, getDigest, saveDigest } from '../../../src/ledger/digest';
import { lastWeek, weekDays } from '../../../src/ledger/digest-week';
import { openLedger } from '../../../src/ledger/migrations';
import { putAdapterHealth, putReceipt, upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import { IsoTs, Receipt, type ReceiptInput } from '../../../src/ledger/types';
import {
  claimId,
  makeClaim,
  makeHealth,
  makeObservation,
  makeReceipt,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

/** The week of Monday 5 October 2026, on the local clock, made at 09:30 on Monday 12 October. */
const MADE_AT = new Date(2026, 9, 12, 9, 30).getTime();
const WEEK = lastWeek(MADE_AT);
const at = (day: number, hour: number): string => isoWithLocalOffset(new Date(2026, 9, 5 + day, hour, 0));

/** The send nobody claimed, to a vendor: an UNASKED receipt's observation. */
const ORPHAN = makeObservation({ rowKeyHash: sha(5), counterparty: 'vendor@supplier.example' });

let db: LedgerDb;

beforeEach(async () => {
  pinClock(isoWithLocalOffset(new Date(MADE_AT)));
  db = await openLedger(uniqueDbName('digest'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const final = (n: number, overrides: Partial<ReceiptInput>): Receipt =>
  Receipt.parse(
    makeReceipt({
      id: ulid(n),
      claimId: claimId(100 + n),
      state: 'FINAL',
      computedAt: at(1, n),
      finalAt: at(1, n),
      ...overrides,
    }),
  );

const NONE: Partial<ReceiptInput> = {
  reasons: [{ code: 'match.none', params: {} }],
  observationIds: [],
  ruleId: 'not_found',
};

/** The claims of the week: an email Muse said it sent to Priya, and a purchase Claude said it made. */
const CLAIMS = [
  makeClaim({
    rawHash: sha(102),
    counterparty: 'priya@company.example',
    subjectHint: 'Q3 review',
    claimedAt: at(1, 14),
  }),
  makeClaim({
    ...{ rawHash: sha(107), agent: 'claude', type: 'purchase.made', counterparty: 'Corner Shop' },
    ...{ amountCents: 12000, currency: 'USD', subjectHint: undefined, claimedAt: at(3, 9) },
  }),
];

/** Receipt `n`: UNASKED about the orphan, likely Muse's; superseded by claim 101 when `superseded`. */
const unasked = (n: number, superseded: boolean): Receipt =>
  Receipt.parse({
    ...omit(
      makeReceipt({
        ...{ id: ulid(n), grade: 'UNASKED', ruleId: 'unasked', observationIds: [ORPHAN.id] },
        reasons: [
          { code: 'unasked.session', params: { agent: 'muse' } },
          ...(superseded ? [{ code: 'superseded' as const, params: { claimId: claimId(101) } }] : []),
        ],
        ...{ state: 'FINAL', computedAt: at(1, n), finalAt: at(1, n) },
      }),
      'claimId',
    ),
    attribution: 'likely',
    ...(superseded ? { supersededBy: claimId(101) } : {}),
  });

/** A week of Muse's and Claude's receipts, every state, and one of the week before. */
function weekReceipts(): Receipt[] {
  const marked = final(5, { grade: 'VERIFIED' });
  return [
    final(1, { grade: 'VERIFIED' }),
    final(2, { grade: 'NOT_FOUND', ...NONE }),
    unasked(3, false),
    Receipt.parse({
      ...makeReceipt({ id: ulid(4), claimId: claimId(104), computedAt: at(2, 8) }),
      state: 'PENDING',
    }),
    Receipt.parse({
      ...marked,
      state: 'USER_OVERRIDDEN',
      reasons: [...marked.reasons, { code: 'override.user', params: { grade: 'NOT_FOUND' } }],
      override: { grade: 'NOT_FOUND', reason: 'not mine', at: at(1, 20), previousState: 'FINAL' },
    }),
    unasked(6, true),
    final(7, {
      ...{ agent: 'claude', grade: 'OVER_SCOPE', ruleId: 'over_scope', observationIds: [] },
      reasons: [{ code: 'scope.type_not_allowed', params: { type: 'purchase.made' } }],
      ...{ computedAt: at(3, 10), finalAt: at(3, 10) },
    }),
    // The week before: in no count.
    final(8, { grade: 'NOT_FOUND', ...NONE, computedAt: at(-2, 10), finalAt: at(-2, 10) }),
  ];
}

async function seed(): Promise<void> {
  for (const claim of CLAIMS) await upsertClaim(db, claim);
  await upsertObservation(db, ORPHAN, DEFAULT_POLICY);
  for (const receipt of weekReceipts()) await putReceipt(db, receipt);
  // Gmail's windows reach Monday to Wednesday noon; Calendar was never open.
  await recordCoverage(db, {
    ...{ observerId: 'gmail.sent', source: 'gmail.sent', accountHash: sha(9) },
    ...{ lastSyncAt: at(2, 12), windowStart: at(0, 0), windowEnd: at(2, 12) },
  });
  await putAdapterHealth(db, makeHealth({ adapterId: 'gmail.sent' }));
}

const ZERO = { VERIFIED: 0, PARTIAL: 0, NOT_FOUND: 0, UNASKED: 0, OVER_SCOPE: 0, UNVERIFIABLE: 0 };
const AGENTS = [
  {
    agent: 'muse',
    grades: { ...ZERO, VERIFIED: 1, NOT_FOUND: 1, UNASKED: 1 },
    checking: 1,
    marked: 1,
    checked: 2,
    verified: 1,
  },
  { agent: 'claude', grades: { ...ZERO, OVER_SCOPE: 1 }, checking: 0, marked: 0, checked: 1, verified: 0 },
];
const NOTABLE = [
  {
    receiptId: ulid(7),
    agent: 'claude',
    grade: 'OVER_SCOPE',
    type: 'purchase.made',
    at: at(3, 9),
    amountCents: 12000,
    currency: 'USD',
  },
  {
    receiptId: ulid(3),
    agent: 'muse',
    grade: 'UNASKED',
    type: 'email.sent',
    at: ORPHAN.occurredAt,
    domain: 'supplier.example',
    subjectHint: 'Quarterly numbers',
  },
  {
    receiptId: ulid(2),
    agent: 'muse',
    grade: 'NOT_FOUND',
    type: 'email.sent',
    at: at(1, 14),
    domain: 'company.example',
    subjectHint: 'Q3 review',
  },
];

describe('buildDigest', () => {
  it("counts each agent's week, calls out the notable receipts by domain, and finds the days not checked", async () => {
    await seed();
    const digest = await buildDigest(db, WEEK, IsoTs.parse(isoWithLocalOffset(new Date(MADE_AT))));
    expect(digest.week).toBe('2026-10-05');
    expect(digest.agents).toEqual(AGENTS);
    expect(digest.notable).toEqual(NOTABLE);
    expect(digest.notableCount).toBe(3);
    expect(JSON.stringify(digest)).not.toMatch(/@/u);
    const days = weekDays(WEEK).map(({ date }) => date);
    expect(digest.gaps).toEqual([
      { source: 'gmail.sent', days: days.slice(3) },
      { source: 'gcal.event', days },
    ]);
    expect(digest.health.map(({ adapterId }) => adapterId)).toEqual(['gmail.sent']);
  });

  it('keeps one digest per week, the newest first', async () => {
    const made = IsoTs.parse(isoWithLocalOffset(new Date(MADE_AT)));
    const before = lastWeek(MADE_AT - 7 * 86_400_000);
    await saveDigest(db, await buildDigest(db, before, made));
    await saveDigest(db, await buildDigest(db, WEEK, made));
    await saveDigest(db, await buildDigest(db, WEEK, made));
    expect(await digestWeeks(db)).toEqual(['2026-10-05', '2026-09-28']);
    expect((await getDigest(db, '2026-10-05'))?.agents).toEqual([]);
  });
});

describe('domainOf', () => {
  it('keeps the domain of an address or a domain, and nothing of a name', () => {
    expect(domainOf('priya@Company.Example')).toBe('company.example');
    expect(domainOf('supplier.example')).toBe('supplier.example');
    expect(domainOf('Corner Shop')).toBeUndefined();
    expect(domainOf('Priya')).toBeUndefined();
    expect(domainOf(undefined)).toBeUndefined();
  });
});
