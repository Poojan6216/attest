/**
 * `coverageFor` holds `gcal.event` coverage closed under overlap (src/ledger/coverage.ts `closeOverlaps`;
 * docs/grading.md §3 Background obligations, v1.9, v1.10; Hard Rule 7), read once and closed in memory. For random
 * Calendar windows and first-look markers (points), two accounts, syncs out of order, and random claim windows and
 * batch instants, the `gcal.event` entries it returns are exactly the fixpoint the orphan rule needs:
 *  - SEEDS: every stored entry synced by `evaluatedAt` that overlaps the claim window, and each account's latest;
 *  - CLOSED: every stored entry synced by `evaluatedAt` that overlaps a returned one is returned;
 *  - LEAST: every returned entry is joined to a seed by a chain of returned entries that overlap;
 *  - nothing synced after `evaluatedAt`.
 * Plus the cost it was rewritten for: one read of the source per call, whatever the number of markers.
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { instantMs } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { canonicalJson } from '../../../src/core/hash';
import { ObserverCoverage } from '../../../src/core/schema';
import { coverageFor, readInterval, recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { isoAt, MS_PER_MINUTE } from '../../tools/attest-world';
import { sha, uniqueDbName } from './fixtures';

const RUNS = 120;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
/** Sun 4 Oct 2026, 00:00 in New York: hour 0 of the grid. */
const GRID_MS = Date.parse('2026-10-04T00:00:00-04:00');
const NOON_MS = Date.parse('2026-10-03T12:00:00-04:00');
const hour = (h: number) => isoAt(GRID_MS + h * MS_PER_HOUR, -240);
const clock = (minutes: number) => isoAt(NOON_MS + minutes * MS_PER_MINUTE, -240);

const entryArb = fc.record({
  startHour: fc.nat({ max: 400 }),
  /** 0: a first-look marker (a point); otherwise a window of whole hours. */
  lengthHours: fc.constantFrom(0, 0, 0, 24, 48, 168),
  syncMinutes: fc.nat({ max: 300 }),
  account: fc.constantFrom(0, 0, 1),
  since: fc.constantFrom('none', 'sync', 'early'),
});

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

function toEntry(e: Generated<typeof entryArb>): ObserverCoverage {
  const lastSyncAt = clock(e.syncMinutes);
  const point = e.lengthHours === 0;
  const since = point ? lastSyncAt : e.since === 'none' ? null : e.since === 'sync' ? lastSyncAt : clock(0);
  return ObserverCoverage.parse({
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt,
    windowStart: hour(e.startHour),
    windowEnd: hour(e.startHour + e.lengthHours),
    accountHash: sha(900 + e.account),
    allCalendars: true,
    ...(since === null ? {} : { changesSince: since }),
  });
}

interface Span {
  readonly key: string;
  readonly entry: ObserverCoverage;
  readonly startMs: number;
  readonly endMs: number;
  readonly syncMs: number;
}

const spanOf = (entry: ObserverCoverage): Span => ({
  key: canonicalJson(entry),
  entry,
  startMs: instantMs(entry.windowStart),
  endMs: instantMs(entry.windowEnd),
  syncMs: instantMs(entry.lastSyncAt),
});
const overlaps = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  a.startMs <= b.endMs && a.endMs >= b.startMs;

let db: LedgerDb;
beforeAll(async () => {
  db = await openLedger(uniqueDbName('coverage-closure-property'));
});
afterAll(() => {
  db.close();
});
beforeEach(async () => {
  await db.coverageIntervals.clear();
});

async function storedSynced(evaluatedMs: number): Promise<Span[]> {
  return (await db.coverageIntervals.toArray())
    .flatMap((row) => readInterval(row)?.entry ?? [])
    .map(spanOf)
    .filter((span) => span.syncMs <= evaluatedMs);
}

/** SEEDS, CLOSED and LEAST (see the header) of the `gcal.event` entries `coverageFor` returned. */
function checkFixpoint(
  all: readonly Span[],
  returned: ReadonlyMap<string, Span>,
  claimSpan: { startMs: number; endMs: number },
): void {
  const latestSync = new Map<string | undefined, number>();
  for (const span of all) {
    const account = span.entry.accountHash;
    latestSync.set(account, Math.max(latestSync.get(account) ?? -Infinity, span.syncMs));
  }
  // SEEDS: the window's entries and each account's latest.
  for (const span of all) if (overlaps(span, claimSpan)) expect(returned.has(span.key)).toBe(true);
  for (const [account, latest] of latestSync) {
    const mine = all.filter((span) => span.entry.accountHash === account && span.syncMs === latest);
    expect(mine.some((span) => returned.has(span.key))).toBe(true);
  }
  // CLOSED.
  for (const span of all) {
    if ([...returned.values()].some((each) => overlaps(each, span)))
      expect(returned.has(span.key)).toBe(true);
  }
  // LEAST: every returned entry is reached from a seed through returned entries.
  const isSeed = (span: Span) =>
    overlaps(span, claimSpan) || span.syncMs === latestSync.get(span.entry.accountHash);
  const reached = new Set([...returned.values()].filter(isSeed).map((span) => span.key));
  let grew = true;
  while (grew) {
    grew = false;
    for (const span of returned.values()) {
      if (reached.has(span.key)) continue;
      if ([...returned.values()].some((each) => reached.has(each.key) && overlaps(each, span))) {
        reached.add(span.key);
        grew = true;
      }
    }
  }
  expect(reached.size).toBe(returned.size);
}

describe('coverageFor closes gcal.event coverage under overlap (property)', () => {
  it('returns exactly the seeds and everything joined to them by overlapping entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(entryArb, { minLength: 1, maxLength: 30 }),
        fc.nat({ max: 400 }),
        fc.integer({ min: 0, max: 72 }),
        fc.nat({ max: 320 }),
        async (entries, fromHour, spanHours, evaluatedMinutes) => {
          await db.coverageIntervals.clear();
          for (const each of entries) await recordCoverage(db, toEntry(each));
          const window = {
            fromMs: GRID_MS + fromHour * MS_PER_HOUR,
            toMs: GRID_MS + (fromHour + spanHours) * MS_PER_HOUR,
          };
          const evaluatedAt = clock(evaluatedMinutes);
          const evaluatedMs = instantMs(evaluatedAt);
          const coverage = await coverageFor(
            db,
            { type: 'calendar.created', window, evaluatedAt },
            DEFAULT_POLICY,
          );
          const all = await storedSynced(evaluatedMs);
          const returned = new Map(coverage.observers.map((entry) => [canonicalJson(entry), spanOf(entry)]));
          for (const span of returned.values()) expect(span.syncMs).toBeLessThanOrEqual(evaluatedMs);
          checkFixpoint(all, returned, { startMs: window.fromMs, endMs: window.toMs });
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('coverageFor reads the Calendar source once per call', () => {
  it('a chain of touching weeks with markers is closed in one read, not one query per entry', async () => {
    for (let week = 0; week < 6; week += 1) {
      const sync = clock(week * 10 + 5);
      await recordCoverage(db, {
        observerId: 'gcal.event',
        source: 'gcal.event',
        accountHash: sha(900),
        allCalendars: true,
        lastSyncAt: sync,
        windowStart: hour(week * 168),
        windowEnd: hour((week + 1) * 168),
        changesSince: clock(week * 10),
      });
      for (let marker = 0; marker < 8; marker += 1) {
        const at = hour(week * 168 + marker * 20 + 9);
        await recordCoverage(db, {
          observerId: 'gcal.event',
          source: 'gcal.event',
          accountHash: sha(900),
          allCalendars: true,
          lastSyncAt: sync,
          windowStart: at,
          windowEnd: at,
          changesSince: sync,
        });
      }
    }
    const where = vi.spyOn(db.coverageIntervals, 'where');
    const coverage = await coverageFor(
      db,
      {
        type: 'calendar.created',
        window: { fromMs: GRID_MS, toMs: GRID_MS + MS_PER_HOUR },
        evaluatedAt: clock(400),
      },
      DEFAULT_POLICY,
    );
    // Every week and every marker is joined to the first week through touching weeks.
    expect(coverage.observers).toHaveLength(6 * 9);
    // The window's entries, the accounts, their latest, and one read of the source for the closure.
    expect(where.mock.calls.length).toBeLessThanOrEqual(5);
    where.mockRestore();
  });
});
