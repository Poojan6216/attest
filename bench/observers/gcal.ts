/// <reference lib="dom" />
/**
 * Calendar observer field accuracy (sprint_2 2.5; agents/adapter_engineer.md rule 10; Hard Rule 12): the
 * gcal.event observer run over every labelled Calendar fixture (extension/tests/fixtures/pages/gcal/<date>/), each
 * read as of its page fact's `readAt` in its page fact's time zone, and compared with the labels
 * (tests/fixtures/pages/README.md):
 *  - every labelled event, field by field: start (`occurredAt`), all-day flag, subject hint, guests, calendar; a
 *    labelled event the observer did not read counts every field wrong, and an event it read that no label names
 *    is counted as spurious;
 *  - health, the coverage windows (exact) and allCalendars;
 *  - every labelled diff, through the pipeline that ships (TECH-13): the observer posts no rows on a page whose
 *    account it names, so the rows are the service worker's. The `from` page, read a minute before the labelled one
 *    (a visible tab is read every minute, so every change is one a followed view saw), is stored as the range's
 *    record after a first look; the labelled page's snapshot is stepped against it as the service worker steps
 *    every pass (src/background/calendar-step.ts `calendarStep`, with the policy's `staleChangeMs` and
 *    src/background/calendar-own.ts `accountMadeChange`), and a deletion is confirmed by a second look at the same
 *    page a minute later (a deletion is reported only after two absences). Every row stored at those passes is
 *    compared with the labels by contentHash after `redact.project()`, so a row that differs in any allowlisted
 *    field, its type or its event is wrong. A `calendar.created` row of an event the `from` page does not show (the
 *    labelled creation, or the first sighting of an event on a calendar switched on) is never counted spurious; every
 *    other unlabelled row is. Every row must also be stored as a first sighting, with its first-look marker
 *    (docs/grading.md §3, §7 v1.12): `gcalStepRowsUnmarked`.
 * The gate (`gcalAccuracyGatePassed`): event field accuracy ≥ 95% (the Gmail Sent bar, sprint_2 2.2), every health,
 * coverage window and allCalendars as labelled, and every labelled diff reproduced exactly with no spurious and no
 * unmarked row (sprint_2 2.5 Done-when). Corpus honesty: the result says how many fixtures are synthetic stand-ins.
 *
 * Fixture pages are parsed with happy-dom in Node (extension devDependency, loaded through the test helper that
 * owns it). `pnpm bench` (bench/run_bench.ts) writes the metrics to bench/results/gcal-<yyyy-mm-dd>.json.
 */
import { accountMadeChange } from '../../extension/src/background/calendar-own';
import {
  type CalendarRow,
  calendarStep,
  type CalendarStep,
  staleChangeMs,
} from '../../extension/src/background/calendar-step';
import { asciiLower, instantMs, isoWithOffset } from '../../extension/src/core/normalize';
import { DEFAULT_POLICY } from '../../extension/src/core/policy';
import { hashRowKey, hashText } from '../../extension/src/core/redact';
import { IsoTs } from '../../extension/src/core/schema';
import type { CalendarRecord } from '../../extension/src/ledger/calendar-snapshots';
import { accountHashOf } from '../../extension/src/observers/account';
import { GCAL_VERSION } from '../../extension/src/observers/gcal/selectors';
import type { CalendarSnapshot, SnapshotEvent } from '../../extension/src/observers/gcal/snapshot';
import type { EventFact, LabelledFixture } from '../../extension/tests/unit/fixtures/fixture-labels';
import {
  ctxOf,
  docOf,
  expectedObservation,
  GCAL_FIXTURES,
  observerFor,
  projectRows,
} from '../../extension/tests/unit/observers/gcal/gcal-fixtures';
import type { MetricValue } from '../results';

/** The bar: the share of labelled event fields read exactly. */
export const GCAL_ACCURACY_GATE = 0.95;

const FIELDS = ['start', 'allDay', 'subject', 'guests', 'calendar'] as const;
type Field = (typeof FIELDS)[number];

interface Tally {
  checked: number;
  correct: number;
}

interface Counts {
  fixtures: number;
  synthetic: number;
  events: number;
  eventsFound: number;
  eventsSpurious: number;
  fields: Record<Field, Tally>;
  health: Tally;
  windows: Tally;
  allCalendars: Tally;
  diffs: Tally;
  diffRows: Tally;
  diffRowsSpurious: number;
  diffRowsUnmarked: number;
}

function emptyCounts(): Counts {
  const tally = (): Tally => ({ checked: 0, correct: 0 });
  return {
    fixtures: 0,
    synthetic: 0,
    events: 0,
    eventsFound: 0,
    eventsSpurious: 0,
    fields: { start: tally(), allDay: tally(), subject: tally(), guests: tally(), calendar: tally() },
    health: tally(),
    windows: tally(),
    allCalendars: tally(),
    diffs: tally(),
    diffRows: tally(),
    diffRowsSpurious: 0,
    diffRowsUnmarked: 0,
  };
}

function count(tally: Tally, ok: boolean): void {
  tally.checked += 1;
  if (ok) tally.correct += 1;
}

function sortedFolded(addresses: readonly string[]): string {
  return addresses.map(asciiLower).sort().join('\n');
}

function fieldsMatch(label: EventFact, read: SnapshotEvent | undefined): Record<Field, boolean> {
  return {
    start: read?.occurredAt === label.occurredAt,
    allDay: read?.allDay === label.allDay,
    subject: read?.subjectHint === label.subjectHint,
    guests: read !== undefined && sortedFolded(read.guests) === sortedFolded(label.attendees),
    calendar: read?.calendar === hashText(label.calendar),
  };
}

function snapshotOf(f: LabelledFixture): CalendarSnapshot | null {
  return observerFor(f).snapshot(docOf(f), ctxOf(f));
}

function tallyEvents(counts: Counts, f: LabelledFixture, snapshot: CalendarSnapshot | null): void {
  const read = new Map((snapshot?.events ?? []).map((event) => [event.key, event]));
  const labelled = new Set(f.events.map((e) => hashRowKey(e.rowKey)));
  for (const label of f.events) {
    const event = read.get(hashRowKey(label.rowKey));
    counts.events += 1;
    if (event !== undefined) counts.eventsFound += 1;
    const matches = fieldsMatch(label, event);
    for (const field of FIELDS) count(counts.fields[field], matches[field]);
  }
  counts.eventsSpurious += [...read.keys()].filter((key) => !labelled.has(key)).length;
}

function tallyPage(counts: Counts, f: LabelledFixture): void {
  const observer = observerFor(f);
  const doc = docOf(f);
  for (const fact of f.health) {
    const health = observer.health(doc);
    const reasons = health.status === 'OK' ? [] : [...health.reasons];
    count(counts.health, health.status === fact.status && reasons.join() === fact.reasons.join());
  }
  const windows = observer.visibleWindows(doc, ctxOf(f)) ?? [];
  const labelled = f.coverage.map((c) => `${c.windowStart}/${c.windowEnd}`);
  const read = windows.map((w) => `${w.windowStart}/${w.windowEnd}`);
  for (const span of labelled) count(counts.windows, read.includes(span));
  counts.windows.checked += Math.max(0, read.length - labelled.length);
  for (const fact of f.coverage) count(counts.allCalendars, observer.allCalendars(doc) === fact.allCalendars);
}

/** How the service worker steps every pass: the policy's bound on late changes, and who made a change (v1.12). */
const STEP = { staleAfterMs: staleChangeMs(DEFAULT_POLICY), ownChange: accountMadeChange };

/** The record the service worker stores after `step` (src/background/calendar-pass.ts). */
function recordOf(step: CalendarStep, account: string): CalendarRecord {
  const accountHash = accountHashOf(account);
  if (accountHash === null) throw new Error('a labelled Calendar page names its account');
  return {
    observerId: 'gcal.event',
    accountHash,
    range: step.snapshot.range,
    snapshot: step.snapshot,
    pending: [...step.pending],
    updates: [...step.updates],
  };
}

/** The UTC offset, in minutes, an ISO 8601 instant is written in ("-04:00" → -240). */
function offsetOf(iso: string): number {
  const match = /([+-])(\d{2}):(\d{2})$/u.exec(iso);
  if (match === null) throw new Error(`no offset in ${iso}`);
  const [, sign = '+', hours = '0', minutes = '0'] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/** `snapshot`'s page read `ms` after `reference` was (a pass's own snapshot: its baseline is its read). */
function readAfter(snapshot: CalendarSnapshot, reference: CalendarSnapshot, ms: number): CalendarSnapshot {
  const readAt = IsoTs.parse(isoWithOffset(instantMs(reference.readAt) + ms, offsetOf(reference.readAt)));
  return { ...snapshot, readAt, baselineAt: readAt };
}

/**
 * The rows the service worker stores for `to` against a stored record of `from` read a minute before it, a deletion
 * confirmed by the same page read a minute after it.
 */
function stepRows(from: CalendarSnapshot, to: CalendarSnapshot, account: string): CalendarRow[] {
  const base = recordOf(calendarStep(null, readAfter(from, to, -60_000), STEP), account);
  const step = calendarStep(base, to, STEP);
  if (step.pending.length === 0) return [...step.rows];
  return [...step.rows, ...calendarStep(recordOf(step, account), readAfter(to, to, 60_000), STEP).rows];
}

function tallyDiffs(counts: Counts, f: LabelledFixture, snapshot: CalendarSnapshot | null): void {
  for (const d of f.diffs) {
    const from = GCAL_FIXTURES.find((g) => g.dir === f.dir && g.file === d.from);
    const previous = from === undefined ? null : snapshotOf(from);
    const rows = snapshot === null || previous === null ? [] : stepRows(previous, snapshot, f.page.account);
    // A `calendar.created` row of an event the `from` page does not show is a creation (labelled) or a first
    // sighting (a calendar switched on): either way not a spurious change. The labels, not the code, say which events
    // each page shows.
    const shownBefore = new Set<string>((from?.events ?? []).map((e) => hashRowKey(e.rowKey)));
    const unseenBefore = (row: CalendarRow): boolean =>
      row.row.type === 'calendar.created' && row.row.rowKey !== undefined && !shownBefore.has(row.row.rowKey);
    const hashes = (list: readonly CalendarRow[]): string[] =>
      projectRows(
        list.map((each) => each.row),
        f.page.readAt,
      ).map((o) => o.contentHash);
    const got = hashes(rows);
    const want: string[] = d.observations.map((o) => expectedObservation(o, f.page.readAt).contentHash);
    for (const hash of want) count(counts.diffRows, got.includes(hash));
    const spurious = hashes(rows.filter((each) => !unseenBefore(each))).filter(
      (hash) => !want.includes(hash),
    );
    counts.diffRowsSpurious += spurious.length;
    counts.diffRowsUnmarked += rows.filter((each) => !each.firstSighting).length;
    count(counts.diffs, spurious.length === 0 && want.every((hash) => got.includes(hash)));
  }
}

function share(tally: Tally): number {
  return tally.checked === 0 ? 0 : Math.round((tally.correct / tally.checked) * 10_000) / 10_000;
}

function all(tally: Tally): boolean {
  return tally.correct === tally.checked;
}

function metricsOf(counts: Counts): Record<string, MetricValue> {
  const fields: Tally = {
    checked: FIELDS.reduce((sum, field) => sum + counts.fields[field].checked, 0),
    correct: FIELDS.reduce((sum, field) => sum + counts.fields[field].correct, 0),
  };
  const accuracy = share(fields);
  const exact =
    all(counts.health) &&
    all(counts.windows) &&
    all(counts.allCalendars) &&
    all(counts.diffs) &&
    counts.diffRowsSpurious === 0 &&
    counts.diffRowsUnmarked === 0;
  return {
    gcalSelectorsVersion: GCAL_VERSION,
    gcalFixtures: counts.fixtures,
    gcalSyntheticFixtures: counts.synthetic,
    gcalEventsLabelled: counts.events,
    gcalEventsFound: counts.eventsFound,
    gcalEventsSpurious: counts.eventsSpurious,
    gcalEventFieldsChecked: fields.checked,
    gcalEventFieldsCorrect: fields.correct,
    gcalStartAccuracy: share(counts.fields.start),
    gcalAllDayAccuracy: share(counts.fields.allDay),
    gcalSubjectAccuracy: share(counts.fields.subject),
    gcalGuestsAccuracy: share(counts.fields.guests),
    gcalCalendarAccuracy: share(counts.fields.calendar),
    gcalHealthCorrect: `${String(counts.health.correct)}/${String(counts.health.checked)}`,
    gcalCoverageWindowsCorrect: `${String(counts.windows.correct)}/${String(counts.windows.checked)}`,
    gcalAllCalendarsCorrect: `${String(counts.allCalendars.correct)}/${String(counts.allCalendars.checked)}`,
    gcalStepDiffsExact: `${String(counts.diffs.correct)}/${String(counts.diffs.checked)}`,
    gcalStepRowsCorrect: `${String(counts.diffRows.correct)}/${String(counts.diffRows.checked)}`,
    gcalStepRowsSpurious: counts.diffRowsSpurious,
    gcalStepRowsUnmarked: counts.diffRowsUnmarked,
    gcalAccuracy: accuracy,
    gcalAccuracyThreshold: GCAL_ACCURACY_GATE,
    gcalAccuracyGatePassed: fields.checked > 0 && accuracy >= GCAL_ACCURACY_GATE && exact,
  };
}

/** Runs the Calendar observer over every labelled fixture and returns the metrics (Promise for the Bench API). */
export function runGcalBench(): Promise<Record<string, MetricValue>> {
  const counts = emptyCounts();
  for (const f of GCAL_FIXTURES) {
    counts.fixtures += 1;
    if (f.page.synthetic) counts.synthetic += 1;
    const snapshot = snapshotOf(f);
    tallyEvents(counts, f, snapshot);
    tallyPage(counts, f);
    tallyDiffs(counts, f, snapshot);
  }
  return Promise.resolve(metricsOf(counts));
}
