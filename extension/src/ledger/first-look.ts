/**
 * First-look markers and the Calendar pass transaction (docs/grading.md §3 `gcal.event` bullet and orphans, §7;
 * Decisions [2.7] wave D; Hard Rules 5, 7).
 *
 * A Calendar row stored as a first sighting is an event its pass could not compare with an earlier view: the first
 * look at a range, a calendar switched on, a day that was hidden behind "N more", an event that began before the
 * visible range, every row of a page with no account. None of those is an action anyone took. Rows carry no account
 * and no pass, so the orphan rule (core batch-orphans.ts `followedChange`, (b)) can tell such a row from a change only
 * by a `gcal.event` entry over the row's own instant that began comparing at its first sighting. The ledger writes
 * that entry, the row's **first-look marker**, in the same readwrite transaction as the row (`upsertFirstSighting`):
 * window = the row's `occurredAt` (a point), `lastSyncAt` = `changesSince` = the row's first sighting, observer and
 * account of the pass that found it. So:
 *  - (b) blocks the row whatever the pass's windows were (one that left out the event's day or its start, or windows
 *    the pass did not record because an absence waited for confirmation);
 *  - a marker never satisfies (a) (it compared nothing before its own sync) and never makes coverage full (a point
 *    never contains a claim window, which is at least a minute long, §4.1);
 *  - a marker is its own merge group (./coverage-merge.ts `isFirstLookMarker`): it never merges with a pass's window.
 * Only a row the upsert inserted gets one. A re-sighting of a stored row changes nothing, and the orphan rule reads
 * the stored row's first sighting, which got its marker when it was stored (or is a change a view followed).
 *
 * `inCalendarPass` is the one readwrite transaction a Calendar pass is stored in, all or none (§3): its rows, their
 * markers, the snapshot record, its coverage windows and latest pings, with `meta` (read for the stamp,
 * ./batch-instant.ts). Any error thrown inside aborts all of it.
 */
import type { Policy } from '../core/policy';
import { type LedgerDb } from './db';
import { LedgerError } from './errors';
import { recordCoverage } from './coverage';
import { isFirstLookMarker } from './coverage-merge';
import { upsertObservation, type UpsertResult, type WriterClock } from './repo';
import { Observation, ObserverCoverage, type ObservationInput, type ObserverCoverageInput } from './types';

export { isFirstLookMarker };

/** The pass that found a first sighting: its observer, its account (none on a page without one) and calendars. */
export interface MarkerOwner {
  readonly observerId: string;
  /** SHA-256 of the account (checked when the marker is parsed). */
  readonly accountHash?: string | undefined;
  /** Whether the pass saw every calendar (omitted when it is not known: then counted as hidden, §6.1). */
  readonly allCalendars?: boolean | undefined;
}

/** The marker of `row` (a `gcal.event` observation, as sighted) found by `owner`'s pass. */
export function firstLookMarker(row: Observation, owner: MarkerOwner): ObserverCoverage {
  const marker: ObserverCoverageInput = {
    observerId: owner.observerId,
    source: 'gcal.event',
    lastSyncAt: row.observedAt,
    windowStart: row.occurredAt,
    windowEnd: row.occurredAt,
    changesSince: row.observedAt,
    ...(owner.accountHash === undefined ? {} : { accountHash: owner.accountHash }),
    ...(owner.allCalendars === undefined ? {} : { allCalendars: owner.allCalendars }),
  };
  return ObserverCoverage.parse(marker);
}

function parseRow(input: ObservationInput): Observation {
  const parsed = Observation.safeParse(input);
  if (parsed.success && parsed.data.source === 'gcal.event') return parsed.data;
  const paths = parsed.success ? ['source'] : parsed.error.issues.map((issue) => issue.path.join('.'));
  throw new LedgerError('invalid_input', 'Invalid observations input', {
    table: 'observations',
    paths: paths.join('|'),
  });
}

/**
 * Stores a `gcal.event` row first seen by `owner`'s pass (`upsertObservation`: the same refusals, `invalid_input`,
 * `id_conflict`, `late_sighting`, and nothing written on any of them) and, when it inserted the row, its first-look
 * marker, in one readwrite transaction over `observations`, `meta` and `coverageIntervals`. A row of another source is
 * `invalid_input`. Runs in the caller's transaction when there is one (`inCalendarPass`). `clock` as for
 * `upsertObservation`.
 */
export async function upsertFirstSighting(
  db: LedgerDb,
  input: ObservationInput,
  policy: Policy,
  owner: MarkerOwner,
  clock: WriterClock = {},
): Promise<UpsertResult> {
  const row = parseRow(input);
  return db.transaction(
    'rw',
    [db.observations, db.meta, db.coverageIntervals],
    async (): Promise<UpsertResult> => {
      const result = await upsertObservation(db, row, policy, clock);
      if (result.inserted) await recordCoverage(db, firstLookMarker(row, owner));
      return result;
    },
  );
}

/**
 * Runs `scope` in one readwrite transaction over every table a Calendar pass writes (see the header): it commits
 * only if `scope` resolves; anything thrown inside, a refusal of a nested write included, aborts every write of it.
 */
export function inCalendarPass<T>(db: LedgerDb, scope: () => Promise<T>): Promise<T> {
  const tables = [db.observations, db.meta, db.calendarSnapshots, db.coverageIntervals, db.coverage];
  // An `async` scope, whatever `scope` is: Dexie keeps its transaction across native awaits only inside one.
  return db.transaction('rw', tables, async (): Promise<T> => {
    const result = await scope();
    return result;
  });
}
