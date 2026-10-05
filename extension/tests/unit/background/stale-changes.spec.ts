/**
 * A change Attest noticed long after it happened never accuses (src/background/calendar-step.ts `staleChangeMs`;
 * docs/grading.md §7; Decisions [2.7] wave E; Hard Rule 7). A Calendar change is first seen at the pass that finds it,
 * and attribution reads that instant. When the snapshot it was compared with is older than the narrowest attribution
 * window, the change may have been made at any time since, and whoever was active when Attest looked again could be
 * named for it: such a creation, update or deletion is stored as a first sighting with its first-look marker. The D2
 * verifier's long-gap probe, kept: the user follows a week, leaves for four hours, and comes back to changes.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coveredObservations, visibleAt } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { instantMs } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { IsoTs } from '../../../src/core/schema';
import { coverageFor } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { Observation } from '../../../src/ledger/types';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, week } from './calendar-fixtures';
import { eventOn, markerOf, markers, runPass, WIDE_WINDOWS_POLICY } from './calendar-pass-harness';
import { contextOf, type TestContext } from './observer-harness';

// Since v1.12 no Calendar change is known to be the account's own (src/background/calendar-own.ts), so none
// accuses. These scenarios keep the rules a change must also meet once it can be (the live smoke, sprint_2 2.8):
// they run as if the account made every change.
vi.mock('../../../src/background/calendar-own', () => ({ accountMadeChange: () => true }));

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('stale-changes'));
  ctx = contextOf(db, { now: () => at(600) });
});

afterEach(() => {
  db.close();
  releaseClock();
});

const standup = eventOn('e', '2026-10-06', 10, { subjectHint: 'Standup' });
const moved = eventOn('e', '2026-10-09', 10, { subjectHint: 'Standup' });
const vendor = eventOn('g', '2026-10-07', 10, { subjectHint: 'Vendor call' });
const board = eventOn('b', '2026-10-08', 13, { subjectHint: 'Board prep' });

async function pass(readAt: IsoTs, events: Parameters<typeof week>[0]): Promise<void> {
  expect(await runPass(ctx, week(events, { readAt }))).toEqual({ ok: true });
}

/** The orphan candidates of a batch at `evaluatedAt` over the week, as `type:subject`. */
async function orphans(evaluatedAt: IsoTs): Promise<string[]> {
  const window = {
    fromMs: Date.parse('2026-10-04T00:00:00-04:00'),
    toMs: Date.parse('2026-10-11T00:00:00-04:00'),
  };
  const coverage = await coverageFor(db, { type: 'calendar.created', window, evaluatedAt }, DEFAULT_POLICY);
  const rows = readRows('observations', Observation, await db.observations.toArray());
  const found = await coveredObservations(
    visibleAt(createMemoryIndex(rows, 15), instantMs(evaluatedAt)),
    coverage,
    DEFAULT_POLICY,
  );
  return found.map(({ observation }) => `${observation.type}:${observation.subjectHint ?? ''}`).sort();
}

const marked = { accountHash: ACCOUNT, allCalendars: false };

describe('changes found four hours after the last look', () => {
  it('are stored as first sightings with their markers: none is an orphan candidate', async () => {
    await pass(at(0), [standup, vendor]);
    await pass(at(1), [standup, vendor]);
    // The user leaves the tab at 12:01 and comes back at 16:00 to a new event, a moved one and one gone.
    await pass(at(240), [moved, board]);
    await pass(at(241), [moved, board]);
    expect(await markers(db)).toEqual(
      expect.arrayContaining([
        markerOf(moved, at(240), marked),
        markerOf(board, at(240), marked),
        markerOf(vendor, at(240), marked),
      ]),
    );
    expect(await orphans(at(250))).toEqual([]);
  });

  it('the same changes compared with a view a minute old are changes Attest saw happen', async () => {
    await pass(at(0), [standup, vendor]);
    await pass(at(1), [standup, vendor]);
    await pass(at(239), [standup, vendor]);
    await pass(at(240), [moved, board]);
    // The deletion's first absence (16:00) was compared with the 15:59 view; its confirmation comes much later.
    await pass(at(300), [moved, board]);
    expect(await orphans(at(310))).toEqual([
      'calendar.created:Board prep',
      'calendar.deleted:Vendor call',
      'calendar.updated:Standup',
    ]);
  });

  it('the bound is the policy’s: with hour-long attribution windows, a 30-minute gap still accuses', async () => {
    ctx = contextOf(db, { now: () => at(600), policy: WIDE_WINDOWS_POLICY });
    await pass(at(0), [standup]);
    await pass(at(30), [standup, board]);
    expect(await orphans(at(40))).toEqual(['calendar.created:Board prep']);
  });
});
