/**
 * The Google Calendar observer, source `gcal.event` (sprint_2 2.5, 2.7; build_spec §7 adapter contract;
 * agents/adapter_engineer.md). The skeleton in src/observers/base.ts runs it: `health()` → `extract()` →
 * `redact.project()` → bus. Read-only and pure over the DOM (Hard Rule 3); every member reads the page through
 * ./read.ts, so within one pass (one synchronous run of src/observers/plan.ts) they all see the same page.
 *
 *  - `health()`: DEGRADED with ./read.ts's reason codes when anything the extractor needs is missing, unreadable or
 *    read in the wrong time zone; nothing is then extracted and no coverage is written (Hard Rules 5, 6).
 *  - `extract()`: the rows the step from the previous snapshot of this range to this page implies, plus the first
 *    sightings of events the previous one could not have seen (./diff.ts). One row per event.
 *  - `visibleWindows()`: one window per run of whole days (./pass.ts); the skeleton posts a coverage.ping for each.
 *  - `allCalendars()`: whether every listed calendar is shown (docs/grading.md §6.1; a `gcal.event` coverage entry
 *    without it counts at most as partial), sent on each ping.
 *  - `snapshot()`: the range's snapshot, which the skeleton posts as `calendar.snapshot` after the coverage of a
 *    clean pass whose account is known; the background keeps it as the range's previous snapshot (sprint_2 2.7).
 * While the page is still drawing its range (./page.ts `pageBusy`), health is OK and the pass reads nothing: no
 * rows, no window, no snapshot, so a half-drawn week is never read as deletions (Hard Rule 5).
 *
 * The previous snapshot comes from the caller (`options.previous`, keyed by range, for this page's account): the
 * background stores snapshots and runs no DOM code; this observer never stores anything, and ./diff.ts stays pure.
 */
import { OBSERVER_HOSTS } from '../../config';
import type { OffsetAt } from '../../core/normalize';
import type { ExtractContext, Observer, RawRow, VisibleWindow } from '../types';
import { calendarPass, extractRows, type PreviousSnapshot } from './extract';
import { gcalHealth } from './health';
import { accountOf, calendarsOf, moreOutsideDays, pageBusy, visibleRange } from './page';
import { coverageWindows } from './pass';
import { readCalendar } from './read';
import { GCAL_VERSION } from './selectors';
import type { CalendarSnapshot } from './snapshot';

export interface GcalObserverOptions {
  /**
   * The UTC offset function `health()` checks the page's own "GMT-04" hint against: the browser's
   * (src/observers/base.ts `browserOffsetAt`), the one every pass's `ctx.offsetAt` carries.
   */
  readonly offsetAt: OffsetAt;
  /**
   * The stored snapshot of `range` for this page's account (its hash), or null when there is none. Parsed here (Zod
   * at the boundary): an invalid one counts as none, so it can only turn changes into first sightings, never invent
   * one. One of another range fails the pass loud (`extract.threw`): the store is keyed by range. Never asked when
   * the page shows no account: such a page is compared with nothing (./extract.ts).
   */
  readonly previous: PreviousSnapshot;
}

export interface GcalObserver extends Observer {
  /** The visible range (`<first day>/<last day>`) the page shows, or null: the key of its stored snapshot. */
  readonly range: (doc: Document) => string | null;
  readonly snapshot: (doc: Document, ctx: ExtractContext) => CalendarSnapshot | null;
  readonly visibleWindows: (doc: Document, ctx: ExtractContext) => readonly VisibleWindow[] | null;
  readonly allCalendars: (doc: Document) => boolean | null;
}

export const GCAL_OBSERVER_ID = 'gcal.event';

/**
 * Every run of whole days, [] when every day hides events behind its own "N more" (read whole, nothing seen whole:
 * OK, no coverage) or while the page is drawing; null (`window.unknown`, DEGRADED) on a page health reports
 * DEGRADED or one with a "more" control in no day, whose layout the reader does not know.
 */
function windowsOf(doc: Document, ctx: ExtractContext): VisibleWindow[] | null {
  if (pageBusy(doc)) return [];
  const read = readCalendar(doc, ctx.offsetAt);
  if (!read.ok || moreOutsideDays(doc)) return null;
  return coverageWindows(read.facts, ctx.offsetAt);
}

/** The Calendar observer. `options` are the caller's (sprint_2 2.7 content script). */
export function createGcalObserver(options: GcalObserverOptions): GcalObserver {
  return Object.freeze({
    id: GCAL_OBSERVER_ID,
    vendor: 'gcal',
    version: GCAL_VERSION,
    hosts: OBSERVER_HOSTS.gcal,
    source: 'gcal.event',
    health: (doc: Document) => gcalHealth(doc, options.offsetAt),
    extract: (doc: Document, ctx: ExtractContext): readonly RawRow[] =>
      pageBusy(doc) ? [] : extractRows(doc, ctx, options.previous),
    account: accountOf,
    visibleWindows: windowsOf,
    range: visibleRange,
    allCalendars: (doc: Document) => calendarsOf(doc)?.every((calendar) => calendar.shown) ?? null,
    snapshot: (doc: Document, ctx: ExtractContext) =>
      !pageBusy(doc) && readCalendar(doc, ctx.offsetAt).ok
        ? calendarPass(doc, ctx, options.previous).snapshot
        : null,
  });
}
