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
 *  - every labelled diff: the change rows the observer emits against the `from` snapshot, compared by contentHash
 *    after `redact.project()`, so a row that differs in any allowlisted field, its type or its event is wrong.
 * The gate (`gcalAccuracyGatePassed`): event field accuracy ≥ 95% (the Gmail Sent bar, sprint_2 2.2), every health,
 * coverage window and allCalendars as labelled, and every labelled diff reproduced exactly with no spurious row
 * (sprint_2 2.5 Done-when). Corpus honesty: the result says how many fixtures are synthetic stand-ins.
 *
 * Fixture pages are parsed with happy-dom in Node (extension devDependency, loaded through the test helper that
 * owns it). `pnpm bench` (bench/run_bench.ts) writes the metrics to bench/results/gcal-<yyyy-mm-dd>.json.
 */
import { asciiLower } from '../../extension/src/core/normalize';
import { hashRowKey, hashText } from '../../extension/src/core/redact';
import { diffSnapshots } from '../../extension/src/observers/gcal/diff';
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
  const windows = observer.visibleWindows(doc, ctxOf(f));
  const labelled = f.coverage.map((c) => `${c.windowStart}/${c.windowEnd}`);
  const read = windows.map((w) => `${w.windowStart}/${w.windowEnd}`);
  for (const span of labelled) count(counts.windows, read.includes(span));
  counts.windows.checked += Math.max(0, read.length - labelled.length);
  for (const fact of f.coverage) count(counts.allCalendars, observer.allCalendars(doc) === fact.allCalendars);
}

function tallyDiffs(counts: Counts, f: LabelledFixture, snapshot: CalendarSnapshot | null): void {
  for (const d of f.diffs) {
    const from = GCAL_FIXTURES.find((g) => g.dir === f.dir && g.file === d.from);
    const previous = from === undefined ? null : snapshotOf(from);
    const rows = snapshot === null || previous === null ? [] : diffSnapshots(previous, snapshot).changes;
    const got = projectRows(rows, f.page.readAt).map((o) => o.contentHash);
    const want = d.observations.map((o) => expectedObservation(o, f.page.readAt).contentHash);
    for (const hash of want) count(counts.diffRows, got.includes(hash));
    const spurious = got.filter((hash) => !want.includes(hash)).length;
    counts.diffRowsSpurious += spurious;
    count(
      counts.diffs,
      spurious === 0 && want.every((hash) => got.includes(hash)) && got.length === want.length,
    );
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
    counts.diffRowsSpurious === 0;
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
    gcalDiffsExact: `${String(counts.diffs.correct)}/${String(counts.diffs.checked)}`,
    gcalDiffRowsCorrect: `${String(counts.diffRows.correct)}/${String(counts.diffRows.checked)}`,
    gcalDiffRowsSpurious: counts.diffRowsSpurious,
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
