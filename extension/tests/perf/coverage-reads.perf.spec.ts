/**
 * Perf gate (TECH-1; tech_reviewer: an index for every hot query path, no full-table scan on a hot path; Hard Rule
 * 5 depends on this store): how many coverage rows the ledger reads to record a ping and to answer a batch's
 * coverage, over a ledger that holds 2,000 first-look markers and 90 days of windows.
 *
 * Counted, not timed, so the gate is deterministic: every row Dexie reads from `coverageIntervals` passes its
 * `reading` hook once (fake-indexeddb in Node). Time per row differs by engine (Chrome's IndexedDB was measured
 * 50-165x faster than fake-indexeddb, Decisions [2.close]); the count does not, and it is what grew with the
 * calendar: before the bounded reads, recording one Calendar week read every future marker, and each calendar claim
 * of a batch read every interval that ends after its window starts.
 *
 * The ledger (built directly as stored rows, as recordCoverage leaves them after merging):
 *  - Calendar: 22 week windows per account (13 past, the current one, 8 ahead), two accounts;
 *  - Gmail Sent: one window per day for 90 days;
 *  - 2,000 first-look markers: events from 90 days back to 60 days ahead, each first seen in the last 80 days.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../src/core/policy';
import { MS_PER_DAY } from '../../src/core/units';
import {
  type CoverageQuery,
  coverageForMany,
  placeEntry,
  recordCoverage,
  toIntervalRow,
} from '../../src/ledger/coverage';
import type { LedgerDb } from '../../src/ledger/db';
import { openLedger } from '../../src/ledger/migrations';
import { ObserverCoverage, type ObserverCoverageInput } from '../../src/ledger/types';

const NOW = Date.parse('2026-10-03T16:00:00Z');
const HOUR = 3_600_000;
const MARKERS = 2_000;
const ACCOUNTS = ['a1'.repeat(32), 'b2'.repeat(32)] as const;
const iso = (ms: number): string => new Date(ms).toISOString();

/** Sunday 27 Sep 2026, 04:00 UTC (midnight in New York): the current week's start. */
const WEEK0 = Date.parse('2026-09-27T04:00:00Z');

function calendarWindows(): ObserverCoverageInput[] {
  const out: ObserverCoverageInput[] = [];
  for (let week = -13; week <= 8; week += 1) {
    const start = WEEK0 + week * 7 * MS_PER_DAY;
    const sync = Math.min(start + 3 * MS_PER_DAY, NOW - HOUR);
    for (const accountHash of ACCOUNTS) {
      out.push({
        observerId: 'gcal.event',
        source: 'gcal.event',
        accountHash,
        allCalendars: true,
        lastSyncAt: iso(sync),
        changesSince: iso(sync - 6 * HOUR),
        windowStart: iso(start),
        windowEnd: iso(start + 7 * MS_PER_DAY),
      });
    }
  }
  return out;
}

function sentWindows(): ObserverCoverageInput[] {
  return Array.from({ length: 90 }, (_, day) => {
    const morning = NOW - (day + 1) * MS_PER_DAY + 8 * HOUR;
    return {
      observerId: 'gmail.sent',
      source: 'gmail.sent',
      accountHash: ACCOUNTS[0],
      lastSyncAt: iso(morning + 14 * HOUR),
      windowStart: iso(morning),
      windowEnd: iso(morning + 14 * HOUR),
    };
  });
}

/** Marker `i`: an event spread over [-90 d, +60 d), first seen within the last 80 days (a point, ./first-look.ts). */
function markers(): ObserverCoverageInput[] {
  return Array.from({ length: MARKERS }, (_, i) => {
    const occurred = NOW - 90 * MS_PER_DAY + Math.floor((i * 150 * MS_PER_DAY) / MARKERS);
    const seen = iso(NOW - (i % 80) * MS_PER_DAY - HOUR);
    return {
      observerId: 'gcal.event',
      source: 'gcal.event',
      accountHash: ACCOUNTS[i % 2],
      allCalendars: true,
      lastSyncAt: seen,
      changesSince: seen,
      windowStart: iso(occurred),
      windowEnd: iso(occurred),
    };
  });
}

let db: LedgerDb;
const read = { rows: 0 };

beforeEach(async () => {
  db = await openLedger(`coverage-reads-${String(Math.random())}`);
  const rows = [...calendarWindows(), ...sentWindows(), ...markers()].map((input) =>
    toIntervalRow(placeEntry(ObserverCoverage.parse(input))),
  );
  await db.coverageIntervals.bulkAdd(rows);
  db.coverageIntervals.hook('reading', (row) => {
    read.rows += 1;
    return row;
  });
});

afterEach(() => {
  db.close();
});

async function rowsReadBy(act: () => Promise<unknown>): Promise<number> {
  read.rows = 0;
  await act();
  return read.rows;
}

/** A ping of this pass: the current Calendar week, or the Gmail Sent head of the list since this morning. */
const weekPing: ObserverCoverageInput = {
  observerId: 'gcal.event',
  source: 'gcal.event',
  accountHash: ACCOUNTS[0],
  allCalendars: true,
  lastSyncAt: iso(NOW),
  changesSince: iso(NOW - 3 * MS_PER_DAY - 7 * HOUR),
  windowStart: iso(WEEK0),
  windowEnd: iso(WEEK0 + 7 * MS_PER_DAY),
};
const sentPing: ObserverCoverageInput = {
  observerId: 'gmail.sent',
  source: 'gmail.sent',
  accountHash: ACCOUNTS[0],
  lastSyncAt: iso(NOW),
  windowStart: iso(NOW - 6 * HOUR),
  windowEnd: iso(NOW),
};

/** 50 calendar claims over the next 50 days and 50 Gmail claims over the past 90, as one batch asks them. */
function batchQueries(): CoverageQuery[] {
  const queries: CoverageQuery[] = [];
  for (let k = 1; k <= 50; k += 1) {
    const at = NOW + k * MS_PER_DAY + 2 * HOUR;
    queries.push({
      type: 'calendar.created',
      window: { fromMs: at - 2 * 60_000, toMs: at + 47 * 60_000 },
      evaluatedAt: iso(NOW),
    });
    const sent = NOW - Math.floor(k * 1.7 * MS_PER_DAY) - 3 * HOUR;
    queries.push({
      type: 'email.sent',
      window: { fromMs: sent - 2 * 60_000, toMs: sent + 47 * 60_000 },
      evaluatedAt: iso(NOW),
    });
  }
  return queries;
}

/** The gates: rows read, on the ledger above (2,134 rows). Before TECH-1: 906, 1 and 27,651; after: 7, 2 and 2,150. */
const GATES = { recordCalendarWeek: 64, recordSentHead: 16, batchOf100Claims: 3_000 } as const;

describe('coverage store reads stay bounded as the calendar fills (TECH-1)', () => {
  it('recording a Calendar week reads its own week, never the markers or windows ahead of it', async () => {
    const rows = await rowsReadBy(() => recordCoverage(db, weekPing));
    console.info(
      `[perf] recordCoverage(gcal.event week): ${String(rows)} rows read (gate ${String(GATES.recordCalendarWeek)})`,
    );
    expect(rows).toBeLessThanOrEqual(GATES.recordCalendarWeek);
  });

  it('recording the Gmail Sent head reads only the windows it may merge with', async () => {
    const rows = await rowsReadBy(() => recordCoverage(db, sentPing));
    console.info(
      `[perf] recordCoverage(gmail.sent head): ${String(rows)} rows read (gate ${String(GATES.recordSentHead)})`,
    );
    expect(rows).toBeLessThanOrEqual(GATES.recordSentHead);
  });

  it('a batch of 100 claims reads each claim’s own span, and the Calendar closure once, not once per claim', async () => {
    const queries = batchQueries();
    let answers: Awaited<ReturnType<typeof coverageForMany>> = [];
    const rows = await rowsReadBy(async () => {
      answers = await coverageForMany(db, queries, DEFAULT_POLICY);
    });
    console.info(
      `[perf] coverageForMany(100 claims): ${String(rows)} rows read (gate ${String(GATES.batchOf100Claims)})`,
    );
    expect(rows).toBeLessThanOrEqual(GATES.batchOf100Claims);
    // Not a fast wrong answer: every calendar claim sees its week's windows, every Gmail claim its day's window.
    expect(answers).toHaveLength(100);
    for (const [index, coverage] of answers.entries()) {
      const source = index % 2 === 0 ? 'gcal.event' : 'gmail.sent';
      expect(coverage.observers.some((entry) => entry.source === source)).toBe(true);
    }
  });
});
