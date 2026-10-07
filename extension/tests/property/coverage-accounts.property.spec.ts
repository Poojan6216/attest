/**
 * Per-account coverage (docs/grading.md v1.11 §6.1; Sprint 2 wave E decision b), 1,000 runs against the §6.1
 * account rule written out with Date.parse: when `grant.accounts[source]` binds two or more distinct accounts, the
 * source is full only when each bound account's own eligible, uncapped entries contain the claim window, and a
 * window that only their union contains is `partial` with `coverage.account_partial`. One bound account, or none (the
 * `coverage.multiple_accounts` and `coverage.no_account` caps), is unchanged. For a Gmail Sent claim and a Calendar
 * created claim, whose entries synced before the claim's grace sync are capped (`coverage.list_unsettled` since
 * v1.14, `coverage.changes_unfollowed` since v1.10), so the rule holds for every source.
 * Each run's tallies are asserted, so no property can pass without reaching its cases.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { coverageLevel } from '../../src/core/conditions';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { MS_PER_MINUTE } from '../../src/core/units';
import { buildClaim, buildCoverage, buildGrant } from '../golden/build';
import { ScenarioClaim, type ScenarioCoverage } from '../golden/scenario-schema';

const RUNS = 1_000;
const BASE_MS = instantMs('2026-10-06T00:00:00-04:00');
const at = (minutes: number): string => isoWithOffset(BASE_MS + minutes * MS_PER_MINUTE, -240);
/** evaluatedAt is minute 900 (15:00); the claims are at minute 600 (10:00). */
const EVAL = at(900);
const CLAIMED = 600;

/** The claim window (§4.1) and grace sync of each kind, in minutes from BASE. */
const KINDS = {
  email: {
    type: 'email.sent',
    source: 'gmail.sent',
    from: CLAIMED - 2,
    to: CLAIMED + 1 + 45,
    grace: CLAIMED + 1 + 45,
    cap: 'coverage.list_unsettled',
  },
  calendar: {
    type: 'calendar.created',
    source: 'gcal.event',
    from: 2_880 - 3 * 1_440,
    to: 2_880 + 3 * 1_440,
    grace: CLAIMED + 1 + 30,
    cap: 'coverage.changes_unfollowed',
  },
} as const;
type Kind = keyof typeof KINDS;

const ACCOUNTS = ['acct-a', 'acct-b', 'acct-c', null] as const;
const GRANTS = [null, ['acct-a'], ['acct-a', 'acct-b'], ['acct-b', 'acct-a', 'acct-b']] as const;

const entryArb = fc.record({
  account: fc.constantFrom(...ACCOUNTS),
  /** Mostly a window around the claim window, sometimes one that misses part of it. */
  from: fc.oneof(fc.constant(-4_000), fc.integer({ min: -4_000, max: 7_000 })),
  to: fc.oneof(fc.constant(8_000), fc.integer({ min: -4_000, max: 8_000 })),
  sync: fc.integer({ min: 590, max: 960 }),
});
interface Entry {
  readonly account: string | null;
  readonly from: number;
  readonly to: number;
  readonly sync: number;
}

/**
 * For a grant of two accounts, one fresh entry over the whole window of each (synced after both kinds' grace sync,
 * by evaluatedAt), at random places among up to three random entries: a full level under two bound accounts needs
 * both, and random entries alone reached it in about 2% of the runs, so 1,000 runs fell to the `twoBoundFull` floor
 * about once in 50 (measured, 2026-10-07).
 */
const twoBoundCaseArb = fc
  .tuple(
    fc.constantFrom<Kind>('email', 'calendar'),
    fc.constantFrom(GRANTS[2], GRANTS[3]),
    fc.array(entryArb, { maxLength: 3 }),
    fc.integer({ min: 650, max: 900 }),
    fc.integer({ min: 650, max: 900 }),
    fc.nat(),
    fc.nat(),
  )
  .map(([kind, bound, rest, syncA, syncB, atA, atB]) => {
    const entries: Entry[] = [...rest];
    entries.splice(atA % (entries.length + 1), 0, {
      account: 'acct-a',
      from: -4_000,
      to: 8_000,
      sync: syncA,
    });
    entries.splice(atB % (entries.length + 1), 0, {
      account: 'acct-b',
      from: -4_000,
      to: 8_000,
      sync: syncB,
    });
    return [kind, bound, entries] as const;
  });

const caseArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.tuple(
      fc.constantFrom<Kind>('email', 'calendar'),
      fc.constantFrom(...GRANTS),
      fc.array(entryArb, { minLength: 1, maxLength: 5 }),
    ),
  },
  { weight: 1, arbitrary: twoBoundCaseArb },
);

function entryOf(kind: Kind, entry: Entry): ScenarioCoverage {
  const { source } = KINDS[kind];
  const [from, to] = entry.from <= entry.to ? [entry.from, entry.to] : [entry.to, entry.from];
  return {
    source,
    lastSyncAt: at(entry.sync),
    windowStart: at(from),
    windowEnd: at(to),
    ...(entry.account === null ? {} : { accountHash: entry.account }),
    ...(source === 'gcal.event' ? { allCalendars: true } : {}),
  };
}

/**
 * True iff the union of the closed [from, to] windows contains [a, b]. A point (a = b: a stale entry that touches the
 * claim window at one end) is contained only by a window that holds it, never by one that ends before it.
 */
function contains(entries: readonly Entry[], a: number, b: number): boolean {
  const spans = entries.map((e) => ({ from: Math.min(e.from, e.to), to: Math.max(e.from, e.to) }));
  let reached = a;
  for (const span of [...spans].sort((x, y) => x.from - y.from)) {
    if (span.from > reached) return false;
    if (span.to < reached) continue;
    reached = span.to;
    if (reached >= b) return true;
  }
  return false;
}

/** §6.1 v1.11 written out for one source: the level and the cap codes. */
function oracle(kind: Kind, entries: readonly Entry[], bound: readonly string[] | null) {
  const { from, to, grace, cap: staleCap } = KINDS[kind];
  const seen = entries.filter((e) => e.sync <= 900);
  const eligible = seen.filter((e) => bound === null || (e.account !== null && bound.includes(e.account)));
  const overlapping = eligible.filter((e) => Math.min(e.from, e.to) <= to && Math.max(e.from, e.to) >= from);
  if (overlapping.length === 0) return { level: 'none', caps: [] as string[] };
  const accounts = new Set(seen.flatMap((e) => (e.account === null ? [] : [e.account])));
  const caps = new Set<string>();
  const groupCaps = (e: Entry): string[] => [
    ...(bound === null && accounts.size > 1 ? ['coverage.multiple_accounts'] : []),
    ...(bound === null && e.account === null ? ['coverage.no_account'] : []),
  ];
  const stale = (e: Entry): boolean => e.sync < grace;
  // A stale entry names its cap only for a span no fresh entry (synced at or after the grace sync) saw (v1.14).
  const fresh = overlapping.filter((e) => !stale(e));
  for (const e of overlapping) {
    for (const cap of groupCaps(e)) caps.add(cap);
    const seen = [Math.max(Math.min(e.from, e.to), from), Math.min(Math.max(e.from, e.to), to)] as const;
    if (stale(e) && !contains(fresh, seen[0], seen[1])) caps.add(staleCap);
  }
  const uncapped = overlapping.filter((e) => !stale(e) && groupCaps(e).length === 0);
  const distinct = [...new Set(bound ?? [])];
  const union = contains(uncapped, from, to);
  const each =
    distinct.length < 2 ||
    distinct.every((account) =>
      contains(
        uncapped.filter((e) => e.account === account),
        from,
        to,
      ),
    );
  if (union && each) return { level: 'full', caps: [] as string[] };
  if (union) caps.add('coverage.account_partial');
  const order = [
    'coverage.changes_unfollowed',
    'coverage.list_unsettled',
    'coverage.account_partial',
    'coverage.multiple_accounts',
    'coverage.no_account',
  ];
  return { level: 'partial', caps: order.filter((cap) => caps.has(cap)) };
}

const tally = { full: 0, pieced: 0, twoBoundFull: 0, unbound: 0 };

describe('per-account coverage (§6.1 v1.11)', () => {
  it('coverageLevel equals the account rule written out, for Gmail Sent and Calendar alike', () => {
    fc.assert(
      fc.property(caseArb, ([kind, bound, entries]) => {
        const { type, source } = KINDS[kind];
        const claim = buildClaim(
          ScenarioClaim.parse({
            ref: 'c1',
            agent: 'muse',
            type,
            counterparty: 'priya@company.com',
            subjectHint: 'Q3 deck',
            claimedAt: at(CLAIMED),
            ...(kind === 'calendar' ? { targetAt: at(2_880) } : {}),
          }),
        );
        const grant = buildGrant(
          { agent: 'muse', ...(bound === null ? {} : { accounts: { [source]: [...bound] } }) },
          EVAL,
        );
        const result = coverageLevel(
          claim,
          grant,
          buildCoverage(
            entries.map((e) => entryOf(kind, e)),
            EVAL,
          ),
          DEFAULT_POLICY,
        );
        const expected = oracle(kind, entries, bound);
        expect(result.level).toBe(expected.level);
        expect(result.capReasons.map((cap) => cap.code)).toEqual(expected.caps);
        if (result.level === 'full') tally.full += 1;
        if (expected.caps.includes('coverage.account_partial')) tally.pieced += 1;
        if (result.level === 'full' && bound !== null && new Set(bound).size > 1) tally.twoBoundFull += 1;
        if (bound === null && result.level !== 'none') tally.unbound += 1;
      }),
      { numRuns: RUNS },
    );
    expect(tally.full).toBeGreaterThan(RUNS / 20);
    expect(tally.pieced).toBeGreaterThan(RUNS / 50);
    expect(tally.twoBoundFull).toBeGreaterThan(RUNS / 100);
    expect(tally.unbound).toBeGreaterThan(RUNS / 10);
  });
});
