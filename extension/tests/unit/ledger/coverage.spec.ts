/**
 * The coverage store (src/ledger/coverage.ts; docs/grading.md §3, §6.1; Sprint 2.6): intervals stored per observer,
 * source and account hash, merged within a group only where they overlap or touch, and `coverageFor` answering in
 * the exact `Coverage` shape grading takes. Done-when: a claim windowed before the first ping gets coverage `none`.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coverageLevel } from '../../../src/core/conditions';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { Claim, Coverage, Grant, type ObserverCoverageInput } from '../../../src/core/schema';
import { coverageFor, coverageForClaim, recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  expectLedgerError,
  makeClaim,
  makeGrant,
  pinClock,
  releaseClock,
  sha,
  uniqueDbName,
} from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('coverage'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const ms = (iso: string) => Date.parse(iso);

/** A Gmail Sent pass of account `sha(900)` that saw 09:00–10:00Z, synced at 10:00Z. */
function pass(overrides: Partial<ObserverCoverageInput> = {}): ObserverCoverageInput {
  return {
    observerId: 'gmail',
    source: 'gmail.sent',
    lastSyncAt: '2026-10-01T10:00:00Z',
    windowStart: '2026-10-01T09:00:00Z',
    windowEnd: '2026-10-01T10:00:00Z',
    accountHash: sha(900),
    ...overrides,
  };
}

const EVALUATED_AT = '2026-10-01T23:00:00Z';
const DAY = { fromMs: ms('2026-10-01T00:00:00Z'), toMs: ms('2026-10-01T23:59:59Z') };
const all = (evaluatedAt = EVALUATED_AT) =>
  coverageFor(db, { type: 'email.sent', window: DAY, evaluatedAt }, DEFAULT_POLICY);
const spans = (coverage: Coverage) =>
  coverage.observers.map((e) => [e.windowStart, e.windowEnd, e.lastSyncAt]);

describe('recordCoverage: storage', () => {
  it('stores a pass and coverageFor returns it as a parsed Coverage', async () => {
    await recordCoverage(db, pass());
    const coverage = await all();
    expect(Coverage.parse(coverage)).toEqual(coverage);
    expect(coverage).toEqual({ evaluatedAt: EVALUATED_AT, observers: [pass()] });
    expect(await db.coverageIntervals.count()).toBe(1);
  });

  it('refuses an entry that fails its schema, by field name only, and writes nothing', async () => {
    const bad: unknown[] = [
      pass({ windowEnd: '2026-10-01T08:00:00Z' }),
      pass({ windowStart: 'yesterday' }),
      { ...pass(), userActive: true },
      pass({ source: 'gmail.inbox' as 'gmail.sent' }),
      pass({ allCalendars: true }),
      pass({ observerId: 'priya@company.com' }),
    ];
    for (const entry of bad) {
      const error = await expectLedgerError(
        recordCoverage(db, entry as ObserverCoverageInput),
        'invalid_input',
      );
      expect(JSON.stringify(error.context)).not.toContain('priya');
    }
    expect(await db.coverageIntervals.count()).toBe(0);
  });

  it('keeps several intervals per source: disjoint passes stay apart, a 1 ms gap is never bridged', async () => {
    await recordCoverage(db, pass());
    await recordCoverage(
      db,
      pass({ windowStart: '2026-10-01T10:00:00.001Z', windowEnd: '2026-10-01T11:00:00Z' }),
    );
    await recordCoverage(
      db,
      pass({ windowStart: '2026-10-01T14:00:00Z', windowEnd: '2026-10-01T15:00:00Z' }),
    );
    expect(spans(await all())).toEqual([
      ['2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'],
      ['2026-10-01T10:00:00.001Z', '2026-10-01T11:00:00Z', '2026-10-01T10:00:00Z'],
      ['2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z', '2026-10-01T10:00:00Z'],
    ]);
  });
});

describe('recordCoverage: a gap is never bridged', () => {
  it('passes 1 ms apart stay two intervals, whichever is recorded first', async () => {
    const early = pass({ windowEnd: '2026-10-01T10:15:00Z', lastSyncAt: '2026-10-01T10:15:00Z' });
    const late = pass({
      windowStart: '2026-10-01T10:15:00.001Z',
      windowEnd: '2026-10-01T11:00:00Z',
      lastSyncAt: '2026-10-01T11:00:00Z',
    });
    for (const order of [
      [early, late],
      [late, early],
    ]) {
      await db.coverageIntervals.clear();
      for (const entry of order) await recordCoverage(db, entry);
      expect(await db.coverageIntervals.count()).toBe(2);
      // A claim at 10:00 (window 09:58–10:46) is only partly seen: the 1 ms at 10:15:00.0005 never was.
      const claim = Claim.parse(
        makeClaim({ claimedAt: '2026-10-01T10:00:00Z', observedAt: '2026-10-01T10:05:00Z' }),
      );
      const grant = Grant.parse(makeGrant({ accounts: { 'gmail.sent': [sha(900)] } }));
      const coverage = await coverageForClaim(db, claim, EVALUATED_AT, DEFAULT_POLICY);
      expect(coverageLevel(claim, grant, coverage, DEFAULT_POLICY).level).toBe('partial');
    }
  });
});

describe('recordCoverage: merging within one group', () => {
  it('merges overlapping and touching passes: earliest start, latest end, latest sync', async () => {
    // Receipt passes merge freely; a Sent or Calendar pass merges only into one that contains it (below).
    const receipt = (overrides: Partial<ObserverCoverageInput> = {}) =>
      pass({ observerId: 'gmail.receipts', source: 'gmail.receipt', ...overrides });
    await recordCoverage(db, receipt());
    await recordCoverage(
      db,
      receipt({
        windowStart: '2026-10-01T10:00:00Z',
        windowEnd: '2026-10-01T12:00:00Z',
        lastSyncAt: '2026-10-01T12:00:00Z',
      }),
    );
    // A late-arriving earlier pass that overlaps both: the union keeps the latest sync.
    await recordCoverage(
      db,
      receipt({
        windowStart: '2026-10-01T08:00:00Z',
        windowEnd: '2026-10-01T09:30:00Z',
        lastSyncAt: '2026-10-01T09:30:00Z',
      }),
    );
    const receipts = await coverageFor(
      db,
      { type: 'purchase.made', window: DAY, evaluatedAt: EVALUATED_AT },
      DEFAULT_POLICY,
    );
    expect(spans(receipts)).toEqual([
      ['2026-10-01T08:00:00Z', '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z'],
    ]);
    expect(await db.coverageIntervals.count()).toBe(1);
  });
});

describe('recordCoverage: Sent passes merge only into a pass that contains them (v1.14)', () => {
  it('a Sent pass merges only into one synced at the same instant or that contains it (v1.14)', async () => {
    // The same three passes as above, on Gmail Sent: no later pass contains an earlier one, so none merge, and an
    // early view keeps its early sync (§6.1 caps a Sent view synced before a claim's grace sync).
    await recordCoverage(db, pass());
    await recordCoverage(
      db,
      pass({
        windowStart: '2026-10-01T10:00:00Z',
        windowEnd: '2026-10-01T12:00:00Z',
        lastSyncAt: '2026-10-01T12:00:00Z',
      }),
    );
    await recordCoverage(
      db,
      pass({
        windowStart: '2026-10-01T08:00:00Z',
        windowEnd: '2026-10-01T09:30:00Z',
        lastSyncAt: '2026-10-01T09:30:00Z',
      }),
    );
    expect(await db.coverageIntervals.count()).toBe(3);
    // A later pass that contains them all takes them in.
    await recordCoverage(
      db,
      pass({
        windowStart: '2026-10-01T07:00:00Z',
        windowEnd: '2026-10-01T12:30:00Z',
        lastSyncAt: '2026-10-01T12:30:00Z',
      }),
    );
    expect(spans(await all())).toEqual([
      ['2026-10-01T07:00:00Z', '2026-10-01T12:30:00Z', '2026-10-01T12:30:00Z'],
    ]);
  });
});

describe('recordCoverage: what never merges', () => {
  it('a pass inside a stored interval changes nothing, and recording it twice is a no-op', async () => {
    await recordCoverage(db, pass());
    const [before] = await db.coverageIntervals.toCollection().primaryKeys();
    await recordCoverage(db, pass());
    await recordCoverage(
      db,
      pass({ windowStart: '2026-10-01T09:10:00Z', lastSyncAt: '2026-10-01T09:50:00Z' }),
    );
    expect(await db.coverageIntervals.toCollection().primaryKeys()).toEqual([before]);
  });

  it('never merges across observers, sources, accounts or allCalendars', async () => {
    const entries = [
      pass(),
      pass({ observerId: 'gmail.receipts' }),
      pass({ source: 'gmail.receipt' }),
      pass({ accountHash: sha(901) }),
      pass({ accountHash: undefined }),
      pass({ observerId: 'gcal', source: 'gcal.event', allCalendars: true }),
      pass({ observerId: 'gcal', source: 'gcal.event', allCalendars: false }),
      pass({ observerId: 'gcal', source: 'gcal.event' }),
    ].map((entry) => Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)));
    for (const entry of entries) await recordCoverage(db, entry as ObserverCoverageInput);
    expect(await db.coverageIntervals.count()).toBe(entries.length);
  });
});

describe('coverageFor: what a claim is graded with', () => {
  it('returns the intervals that overlap the window and were synced by evaluatedAt', async () => {
    await recordCoverage(db, pass());
    await recordCoverage(
      db,
      pass({
        windowStart: '2026-10-02T09:00:00Z',
        windowEnd: '2026-10-02T10:00:00Z',
        lastSyncAt: '2026-10-02T10:00:00Z',
      }),
    );
    const window = { fromMs: ms('2026-10-01T09:30:00Z'), toMs: ms('2026-10-01T09:40:00Z') };
    const at = (evaluatedAt: string) =>
      coverageFor(db, { type: 'email.sent', window, evaluatedAt }, DEFAULT_POLICY);
    // The later pass does not overlap and is not the account's latest by 23:00 on Oct 1: left out.
    expect(spans(await at(EVALUATED_AT))).toEqual([
      ['2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'],
    ]);
    // A pass synced after evaluatedAt is never returned (§3).
    expect((await at('2026-10-01T09:59:59.999Z')).observers).toEqual([]);
  });

  it("returns each account's latest interval too, so §6.1 counts every account the source was seen with", async () => {
    await recordCoverage(db, pass());
    await recordCoverage(
      db,
      pass({
        accountHash: sha(901),
        windowStart: '2026-09-20T09:00:00Z',
        windowEnd: '2026-09-20T10:00:00Z',
        lastSyncAt: '2026-09-20T10:00:00Z',
      }),
    );
    const claim = Claim.parse(
      makeClaim({ claimedAt: '2026-10-01T09:14:00Z', observedAt: '2026-10-01T09:20:00Z' }),
    );
    const coverage = await coverageForClaim(db, claim, EVALUATED_AT, DEFAULT_POLICY);
    expect(coverage.observers.map((e) => e.accountHash)).toEqual([sha(901), sha(900)]);
    const level = coverageLevel(claim, Grant.parse(makeGrant()), coverage, DEFAULT_POLICY);
    expect(level).toMatchObject({
      level: 'partial',
      capReasons: [{ code: 'coverage.multiple_accounts', source: 'gmail.sent' }],
    });
    const bound = Grant.parse(makeGrant({ accounts: { 'gmail.sent': [sha(900)] } }));
    expect(coverageLevel(claim, bound, coverage, DEFAULT_POLICY).level).toBe('full');
  });
});

describe('coverageFor: sources and arguments', () => {
  it("reads only the type's relevant sources (§6.1), and nothing for a type with none", async () => {
    await recordCoverage(db, pass({ source: 'gmail.receipt', observerId: 'gmail.receipts' }));
    await recordCoverage(db, pass({ observerId: 'gcal', source: 'gcal.event', allCalendars: true }));
    expect((await all()).observers).toEqual([]);
    const purchase = await coverageFor(
      db,
      { type: 'purchase.made', window: DAY, evaluatedAt: EVALUATED_AT },
      DEFAULT_POLICY,
    );
    expect(purchase.observers.map((e) => e.source)).toEqual(['gmail.receipt']);
    const message = await coverageFor(
      db,
      { type: 'message.sent', window: DAY, evaluatedAt: EVALUATED_AT },
      DEFAULT_POLICY,
    );
    expect(message.observers).toEqual([]);
  });

  it('refuses a malformed evaluatedAt or window', async () => {
    await expectLedgerError(
      coverageFor(db, { type: 'email.sent', window: DAY, evaluatedAt: '2026-10-01' }, DEFAULT_POLICY),
      'invalid_input',
    );
    for (const window of [
      { fromMs: 2, toMs: 1 },
      { fromMs: Number.NaN, toMs: 1 },
      { fromMs: 0, toMs: 2 ** 53 },
    ]) {
      await expectLedgerError(
        coverageFor(db, { type: 'email.sent', window, evaluatedAt: EVALUATED_AT }, DEFAULT_POLICY),
        'invalid_input',
      );
    }
  });
});

describe('Done-when: a claim windowed before the first ping gets coverage none', () => {
  it('is graded UNVERIFIABLE by no_coverage, never NOT_FOUND, though the observer synced after its window', async () => {
    await recordCoverage(db, pass());
    // "Sent Alice the numbers" at 08:00Z: window 07:58–08:46Z, before the first pass saw anything (09:00Z).
    const claim = Claim.parse(
      makeClaim({ claimedAt: '2026-10-01T08:00:00Z', observedAt: '2026-10-01T08:05:00Z' }),
    );
    const grant = Grant.parse(makeGrant({ accounts: { 'gmail.sent': [sha(900)] } }));
    const coverage = await coverageForClaim(db, claim, EVALUATED_AT, DEFAULT_POLICY);
    expect(coverageLevel(claim, grant, coverage, DEFAULT_POLICY).level).toBe('none');
    const receipt = grade(claim, [], grant, DEFAULT_POLICY, coverage, { priorSpendCents: 0 });
    expect(receipt).toMatchObject({ grade: 'UNVERIFIABLE', ruleId: 'no_coverage' });
  });

  it('a claim inside the first pass is covered (full), the same ledger and grant', async () => {
    await recordCoverage(db, pass({ windowStart: '2026-10-01T07:00:00Z' }));
    const claim = Claim.parse(
      makeClaim({ claimedAt: '2026-10-01T08:00:00Z', observedAt: '2026-10-01T08:05:00Z' }),
    );
    const grant = Grant.parse(makeGrant({ accounts: { 'gmail.sent': [sha(900)] } }));
    const coverage = await coverageForClaim(db, claim, EVALUATED_AT, DEFAULT_POLICY);
    expect(coverageLevel(claim, grant, coverage, DEFAULT_POLICY).level).toBe('full');
  });

  it('with no ledger coverage at all the level is none too', async () => {
    const claim = Claim.parse(
      makeClaim({ claimedAt: '2026-10-01T08:00:00Z', observedAt: '2026-10-01T08:05:00Z' }),
    );
    const coverage = await coverageForClaim(db, claim, EVALUATED_AT, DEFAULT_POLICY);
    expect(coverage.observers).toEqual([]);
    expect(coverageLevel(claim, Grant.parse(makeGrant()), coverage, DEFAULT_POLICY).level).toBe('none');
  });
});
