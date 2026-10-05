/**
 * One Calendar pass, decided (sprint_2 2.7; docs/grading.md §3, §4.1, §7; Decisions [2.7]; Hard Rules 4, 5, 7). PURE:
 * no DOM, no clock, no I/O. ./calendar-pass.ts stores what it decides.
 *
 * `calendarStep(stored, next, options)` compares the snapshot a pass posted (`next`, the page form) with the range's
 * stored record (the comparison base, in the stored form, and the absences it waits to confirm, src/ledger/
 * calendar-snapshots.ts) through the observer's own pure diff (src/observers/gcal/diff.ts `diffSnapshots`), and says:
 *  - the rows to store, each with the instant it was first seen (its `observedAt` on the way in, §3, §10), and whether
 *    it is stored as a first sighting, with its first-look marker (src/ledger/first-look.ts): creations and updates as
 *    the diff reports them, every first sighting (an event the base could not have seen: the first look at a range, a
 *    calendar switched on, a day that was hidden), and deletions only once confirmed;
 *  - the record to store next: the base (in its stored form), the absences it waits on, and the update windows
 *    (./calendar-churn.ts);
 *  - how the pass's windows may be recorded as coverage, and how many update rows it held back (SEC-11).
 *
 * Rules (no change is ever inferred from an absence a snapshot cannot vouch for: a hidden day, a calendar named
 * twice, no account):
 *  - No stored record, or one read under other selectors: a first look. Every event is a first sighting; nothing is
 *    a change.
 *  - A deletion is reported only after the event is absent from two consecutive complete snapshots. A snapshot is
 *    complete (`chainable`) when it saw every day of the range whole and the list names each calendar once. The first
 *    absence is kept in the record (`pending`, the event stays in the base); the second confirms it, and the row is
 *    reported as first seen at the first absence. The event coming back clears it. A snapshot that is not complete
 *    vouches for no absence: the base keeps the events it lacks (on calendars it shows), with any pending absence.
 *  - Creations and updates come from the diff as it decides them (a creation needs a base that saw the range whole,
 *    otherwise the event is a first sighting: the same `calendar.created` row). An event the base holds never
 *    becomes a creation or a first sighting again, so an edit is one `calendar.updated` row, never a new
 *    `calendar.created` row of the event's new state (Hard Rules 5, 7). At most CHURN_LIMIT updates of one event are
 *    stored per window; past that they are held back (./calendar-churn.ts).
 *  - Changes are followed (`baselineAt`, then the coverage's `changesSince`) from the first of an unbroken run of
 *    complete snapshots of the range that show the same calendars. Coverage of a complete pass with nothing pending
 *    is recorded with `changesSince`; a complete pass that waits to confirm an absence records none (a batch must not
 *    read "every change was seen" while one is unreported, Hard Rule 5); a pass that is not complete, or one that held
 *    an update back, records its windows without `changesSince` (it covers what was there, not every change), and a
 *    pass that held an update back also breaks the run.
 *  - Who made a change (docs/grading.md §3, §7 v1.12; Decisions [2.close]; Hard Rule 7). A change may accuse an
 *    agent only when the account itself made it, and other people change the account's calendar too (an invitation
 *    Google adds, an organiser's reschedule or cancellation, an edit on a shared calendar). `options.ownChange` says
 *    whether the account made the change a row reports, from the event's state the row describes (the new one, or
 *    the deleted one); a change it did not make is a first sighting. The service worker passes
 *    ./calendar-own.ts `accountMadeChange`, which since v1.12 knows of no change the account made: every creation,
 *    update and confirmed deletion is stored as a first sighting with its first-look marker, evidence for a claim
 *    (§4.1) that never accuses an agent.
 *  - A change noticed late is a first sighting (Decisions [2.7] wave E; Hard Rule 7). A change happened somewhere
 *    between the read of its comparison base and its first sighting, and attribution reads the first sighting
 *    (docs/grading.md §7). When the base was read more than `staleAfterMs` before it, the change may lie outside the
 *    windows attribution reads around that instant, so whoever was active when Attest looked could be named for a
 *    change made long before: such a creation or update (base: the stored snapshot) and such a confirmed deletion
 *    (base: the snapshot its first absence was compared with, kept in the record as `baseAt`) is flagged a first
 *    sighting, stored with its first-look marker, and never accuses an agent. `staleAfterMs` is
 *    `staleChangeMs(policy)`: the narrowest of the §7 windows.
 */
import { instantMs } from '../core/normalize';
import type { Policy } from '../core/policy';
import { type IsoTs, Sha256 } from '../core/schema';
import { MS_PER_MINUTE } from '../core/units';
import type { CalendarRecord, PendingAbsence, UpdateWindow } from '../ledger/calendar-snapshots';
import { type CalendarEvent, diffSnapshots } from '../observers/gcal/diff';
import {
  type CalendarSnapshot,
  type StoredEvent,
  StoredSnapshot,
  storedSnapshotOf,
} from '../observers/gcal/snapshot';
import type { RawRow } from '../observers/types';
import { capUpdates } from './calendar-churn';
import type { OwnChange } from './calendar-own';

/**
 * One row the pass reports, with the instant it was first seen, and whether it is stored as a first sighting: with
 * its first-look marker (src/ledger/first-look.ts), so it never accuses an agent (docs/grading.md §3, §7; Hard Rule
 * 7). Under ./calendar-own.ts `accountMadeChange` (v1.12) every row is.
 */
export interface CalendarRow {
  readonly row: RawRow;
  readonly sightedAt: IsoTs;
  readonly firstSighting: boolean;
}

/** How a pass's windows may be recorded (see the module comment). */
export type CalendarCoverage =
  | { readonly kind: 'followed'; readonly changesSince: IsoTs }
  | { readonly kind: 'plain' }
  | { readonly kind: 'none' };

export interface CalendarStep {
  readonly rows: readonly CalendarRow[];
  /** The range's next comparison base, the absences it waits to confirm and its update windows. */
  readonly snapshot: StoredSnapshot;
  readonly pending: readonly PendingAbsence[];
  readonly updates: readonly UpdateWindow[];
  readonly coverage: CalendarCoverage;
  /** How many `calendar.updated` rows were held back by the per-event cap (./calendar-churn.ts); 0 for none. */
  readonly heldBack: number;
}

/** What decides a step besides its two snapshots. */
export interface StepOptions {
  /** A change whose comparison base was read more than this before its first sighting is a first sighting. */
  readonly staleAfterMs: number;
  /** Whether the account made a change (./calendar-own.ts); a change it did not make is a first sighting. */
  readonly ownChange: OwnChange;
}

/**
 * The longest gap, in ms, between a change's comparison base and its first sighting for which the change still
 * accuses: the narrowest of the attribution windows (`unasked.windows`: session, idle, adjacent; docs/grading.md §7).
 * Within it every window attribution reads around the first sighting holds every instant the change could have
 * happened at, so the signals that fire speak of the change, not only of when Attest looked.
 */
export function staleChangeMs(policy: Pick<Policy, 'unasked'>): number {
  const { sessionMin, idleMin, adjacentMin } = policy.unasked.windows;
  return Math.min(sessionMin, idleMin, adjacentMin) * MS_PER_MINUTE;
}

const isStale = (baseAt: IsoTs | undefined, sightedAt: IsoTs, options: StepOptions): boolean =>
  baseAt === undefined || instantMs(sightedAt) - instantMs(baseAt) > options.staleAfterMs;

/** Whether a snapshot saw every day of its range whole and its list names each calendar once. */
export function chainable(snapshot: CalendarSnapshot | StoredSnapshot): boolean {
  return (
    snapshot.days.every((day) => day.complete) &&
    snapshot.calendars.every((calendar) => calendar.ambiguous !== true)
  );
}

function shownCalendars(snapshot: CalendarSnapshot | StoredSnapshot): ReadonlySet<string> {
  return new Set(snapshot.calendars.filter((calendar) => calendar.shown).map((calendar) => calendar.key));
}

function sameShown(a: CalendarSnapshot | StoredSnapshot, b: CalendarSnapshot | StoredSnapshot): boolean {
  const left = shownCalendars(a);
  const right = shownCalendars(b);
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** The stored form of `next` with `baselineAt` and the base's events it carries on (none by default). */
function baseOf(next: CalendarSnapshot, baselineAt: IsoTs, carried: readonly StoredEvent[] = []): unknown {
  const stored = storedSnapshotOf(next);
  return { ...stored, baselineAt, events: [...stored.events, ...carried] };
}

/** The stored base `next` can be compared with: same range, read under the same selectors. */
function comparable(stored: CalendarRecord | null, next: CalendarSnapshot): stored is CalendarRecord {
  return stored !== null && stored.snapshot.range === next.range && stored.snapshot.version === next.version;
}

/** A first look at the range: every event a first sighting, a chain starting now when the pass is complete. */
function firstLook(next: CalendarSnapshot): CalendarStep {
  return {
    rows: diffSnapshots(null, next).sightings.map((row) => ({
      row,
      sightedAt: next.readAt,
      firstSighting: true,
    })),
    snapshot: StoredSnapshot.parse(baseOf(next, next.readAt)),
    pending: [],
    updates: [],
    coverage: chainable(next) ? { kind: 'followed', changesSince: next.readAt } : { kind: 'plain' },
    heldBack: 0,
  };
}

/** The event of `events` a row describes (by its key), if any. */
function eventOf(row: RawRow, events: ReadonlyMap<string, CalendarEvent>): CalendarEvent | undefined {
  return row.rowKey === undefined ? undefined : events.get(row.rowKey);
}

/** Whether a change to `event` must be stored as a first sighting: not known to be the account's own, or late. */
function asSighting(
  event: CalendarEvent | undefined,
  baseAt: IsoTs | undefined,
  sightedAt: IsoTs,
  options: StepOptions,
): boolean {
  return event === undefined || !options.ownChange(event) || isStale(baseAt, sightedAt, options);
}

/**
 * The absences of `absences` the stored record already held (confirmed: first seen at the first absence, a first
 * sighting when that absence was noticed late or is not the account's own), and the first ones (pending, compared
 * with the stored snapshot).
 */
function sortAbsences(
  absences: readonly RawRow[],
  stored: CalendarRecord,
  readAt: IsoTs,
  options: StepOptions,
): { confirmed: CalendarRow[]; fresh: PendingAbsence[] } {
  const waiting = new Map(stored.pending.map((absence) => [absence.key, absence]));
  const base = new Map<string, CalendarEvent>(stored.snapshot.events.map((event) => [event.key, event]));
  const confirmed: CalendarRow[] = [];
  const fresh: PendingAbsence[] = [];
  for (const row of absences) {
    const key = Sha256.safeParse(row.rowKey);
    if (!key.success) continue;
    const first = waiting.get(key.data);
    if (first === undefined) fresh.push({ key: key.data, since: readAt, baseAt: stored.snapshot.readAt });
    else {
      const firstSighting = asSighting(eventOf(row, base), first.baseAt, first.since, options);
      confirmed.push({ row, sightedAt: first.since, firstSighting });
    }
  }
  return { confirmed, fresh };
}

/**
 * The base's events `next` lacks that stay in the next base: the first absences (`fresh`), and, when `next` vouches
 * for no absence, every one on a calendar `next` shows, with the absence it was already waiting on.
 */
function carriedEvents(
  stored: CalendarRecord,
  next: CalendarSnapshot,
  fresh: readonly PendingAbsence[],
): { events: StoredEvent[]; pending: PendingAbsence[] } {
  const present = new Set(next.events.map((event) => event.key));
  const freshKeys = new Set(fresh.map((absence) => absence.key));
  const waiting = new Map(stored.pending.map((absence) => [absence.key, absence]));
  const shown = shownCalendars(next);
  const vouches = chainable(next);
  const events: StoredEvent[] = [];
  const pending: PendingAbsence[] = [...fresh];
  for (const event of stored.snapshot.events) {
    if (present.has(event.key)) continue;
    if (freshKeys.has(event.key)) events.push(event);
    else if (!vouches && shown.has(event.calendar)) {
      events.push(event);
      const first = waiting.get(event.key);
      if (first !== undefined) pending.push(first);
    }
  }
  return { events, pending };
}

function coverageOf(next: CalendarSnapshot, pending: number, followed: IsoTs | null): CalendarCoverage {
  if (!chainable(next)) return { kind: 'plain' };
  if (pending > 0) return { kind: 'none' };
  return followed === null ? { kind: 'plain' } : { kind: 'followed', changesSince: followed };
}

/** The rows of a pass compared with its stored base: changes (capped), confirmed deletions, first sightings. */
function rowsOf(
  stored: CalendarRecord,
  next: CalendarSnapshot,
  options: StepOptions,
): { rows: CalendarRow[]; fresh: PendingAbsence[]; updates: readonly UpdateWindow[]; heldBack: number } {
  const diff = diffSnapshots(stored.snapshot, next);
  const absences = chainable(next) ? diff.changes.filter((row) => row.type === 'calendar.deleted') : [];
  const { confirmed, fresh } = sortAbsences(absences, stored, next.readAt, options);
  // Every event the next base can hold; `compared` keeps the windows of those it does hold (`heldIn`).
  const known = new Set([...next.events, ...stored.snapshot.events].map((event) => event.key));
  const changes = diff.changes.filter((row) => row.type !== 'calendar.deleted');
  const capped = capUpdates(changes, stored.updates, next.readAt, known);
  const now = new Map<string, CalendarEvent>(next.events.map((event) => [event.key, event]));
  const baseAt = stored.snapshot.readAt;
  const rows = [
    ...capped.rows.map((row) => ({
      row,
      sightedAt: next.readAt,
      firstSighting: asSighting(eventOf(row, now), baseAt, next.readAt, options),
    })),
    ...confirmed,
    ...diff.sightings.map((row) => ({ row, sightedAt: next.readAt, firstSighting: true })),
  ];
  return { rows, fresh, updates: capped.updates, heldBack: capped.heldBack };
}

/** A pass compared with a stored base of its range (see the module comment). */
function compared(stored: CalendarRecord, next: CalendarSnapshot, options: StepOptions): CalendarStep {
  const base = stored.snapshot;
  const { rows, fresh, updates, heldBack } = rowsOf(stored, next, options);
  const continues = heldBack === 0 && chainable(base) && chainable(next) && sameShown(base, next);
  const baselineAt =
    continues && instantMs(base.baselineAt) <= instantMs(next.readAt) ? base.baselineAt : next.readAt;
  const carried = carriedEvents(stored, next, fresh);
  const snapshot = StoredSnapshot.safeParse(baseOf(next, baselineAt, carried.events));
  const followed = heldBack === 0 ? baselineAt : null;
  if (!snapshot.success) {
    // More events than one snapshot holds: keep this pass alone, forget what it could not confirm, restart the chain.
    const restarted = StoredSnapshot.parse(baseOf(next, next.readAt));
    const coverage = coverageOf(next, 0, heldBack === 0 ? next.readAt : null);
    return {
      rows,
      snapshot: restarted,
      pending: [],
      updates: heldIn(updates, restarted),
      coverage,
      heldBack,
    };
  }
  return {
    rows,
    snapshot: snapshot.data,
    pending: carried.pending,
    updates: heldIn(updates, snapshot.data),
    coverage: coverageOf(next, carried.pending.length, followed),
    heldBack,
  };
}

/** The windows of the events `base` holds. */
function heldIn(updates: readonly UpdateWindow[], base: StoredSnapshot): UpdateWindow[] {
  const keys = new Set(base.events.map((event) => event.key));
  return updates.filter((window) => keys.has(window.key));
}

/**
 * The pass that posted `next`, against the stored record of its range (null when there is none, or none readable).
 * Throws only on a bug (a snapshot that fails its own schema once re-based).
 */
export function calendarStep(
  stored: CalendarRecord | null,
  next: CalendarSnapshot,
  options: StepOptions,
): CalendarStep {
  return comparable(stored, next) ? compared(stored, next, options) : firstLook(next);
}
