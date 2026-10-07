/**
 * The Google Calendar observer, source `gcal.event` (sprint_2 2.5, 2.7; build_spec §7 adapter contract;
 * agents/adapter_engineer.md). The skeleton in src/observers/base.ts runs it: `health()` → `extract()` →
 * `redact.project()` → bus. Read-only and pure over the DOM (Hard Rule 3). Every member answers from one read of the
 * page per pass (./pass-read.ts, TECH-2), so within one pass they all describe the same page.
 *
 *  - `health()`: DEGRADED with ./read.ts's reason codes when anything the extractor needs is missing, unreadable or
 *    read in the wrong time zone; nothing is then extracted and no coverage is written (Hard Rules 5, 6). A page
 *    still drawing is OK and read no further, until it has stayed busy too long (./health.ts, `page.busy`).
 *  - `extract()`: no rows on a page that names its account (the service worker derives them from the snapshot), the
 *    first sighting of every event on a page that names none (./extract.ts).
 *  - `visibleWindows()`: one window per run of whole days (./pass.ts); the skeleton posts a coverage.ping for each.
 *  - `allCalendars()`: whether every listed calendar is shown (docs/grading.md §6.1; a `gcal.event` coverage entry
 *    without it counts at most as partial), sent on each ping.
 *  - `snapshot()`: the range's snapshot (the page form, ./snapshot.ts), which the skeleton posts as
 *    `calendar.snapshot` after the coverage of a clean pass whose account is known; the service worker keeps it as
 *    the range's comparison base (src/background/calendar-pass.ts).
 *  - `passAccount(readAt)`: the hash of the account the pass that read a snapshot at `readAt` read, so the snapshot
 *    message names that same account (./script.ts; Decisions [2.7]).
 * While the page is still drawing its range (./page.ts `pageBusy`), the pass reads nothing: no rows, no window, no
 * snapshot, so a half-drawn week is never read as deletions (Hard Rule 5).
 *
 * The observer keeps what one content script needs between passes, in memory only: the run of passes that found the
 * page busy, and the account of the latest snapshot. It never stores anything (no storage, no bus).
 */
import { OBSERVER_HOSTS } from '../../config';
import { instantMs, type OffsetAt } from '../../core/normalize';
import type { Sha256 } from '../../core/schema';
import { accountHashOf } from '../account';
import { selectorAttributes } from '../batch';
import type { ExtractContext, Observer, VisibleWindow } from '../types';
import { calendarRows } from './extract';
import { type BusyRun, continuedRun, extendBusyRun, healthOf } from './health';
import { calendarsOf, someCalendarListEmpty } from './page';
import { coverageWindows, snapshotOf } from './pass';
import { type PassRead, passReads } from './pass-read';
import { GCAL_SELECTORS, GCAL_VERSION } from './selectors';
import type { CalendarSnapshot } from './snapshot';

export interface GcalObserverOptions {
  /**
   * The UTC offset function the observer reads times with and `health()` checks the page's own "GMT-04" hint against:
   * the browser's (src/observers/time-zone.ts `browserOffsetAt`), the one every pass's `ctx.offsetAt` carries.
   */
  readonly offsetAt: OffsetAt;
}

export interface GcalObserver extends Observer {
  readonly snapshot: (doc: Document, ctx: ExtractContext) => CalendarSnapshot | null;
  readonly visibleWindows: (doc: Document, ctx: ExtractContext) => readonly VisibleWindow[] | null;
  readonly allCalendars: (doc: Document) => boolean | null;
  /** The account hash of the pass whose snapshot was read at `readAt`; null for a page with none, or another pass. */
  readonly passAccount: (readAt: string) => Sha256 | null;
}

export const GCAL_OBSERVER_ID = 'gcal.event';

/**
 * Every attribute a read of the page depends on (TECH-2; src/observers/types.ts `attributes`): the ones the selectors
 * match on and the ones the reader reads off elements, the account switcher's label included. The content script's
 * watcher starts a pass on a change to one of these (or to the tree, the text, `class`, `hidden` or `style`), not on a
 * hover or focus change that touches only other attributes.
 */
export const GCAL_ATTRIBUTES: readonly string[] = Object.freeze(
  [
    ...new Set([
      ...selectorAttributes(Object.values(GCAL_SELECTORS.selectors)),
      ...Object.values(GCAL_SELECTORS.attributes),
    ]),
  ].sort(),
);

/**
 * Every run of whole days, [] when every day hides events behind its own "N more" (read whole, nothing seen whole:
 * OK, no coverage) or while the page is drawing; null (`window.unknown`, DEGRADED) on a page health reports
 * DEGRADED or one with a "more" control in no day, whose layout the reader does not know.
 */
function windowsOf(read: PassRead, offsetAt: OffsetAt): VisibleWindow[] | null {
  if (read.busy) return [];
  if (!read.page.ok || read.strayMore) return null;
  return coverageWindows(read.page.facts, offsetAt);
}

/**
 * Whether every calendar the page lists is shown; null when it lists none. False while a calendar list is drawn
 * empty (./page.ts `someCalendarListEmpty`): its calendars' states are not on the page.
 */
function allShown(read: PassRead, doc: Document): boolean | null {
  const calendars = !read.busy && read.page.ok ? read.page.facts.calendars : calendarsOf(doc);
  if (calendars === null) return null;
  return !someCalendarListEmpty(doc) && calendars.every((calendar) => calendar.shown);
}

/** The latest snapshot's instant and the hash of the account its pass read (null: the page named none). */
interface SnapshotAccount {
  readonly at: string;
  readonly accountHash: Sha256 | null;
}

/** The Calendar observer of one content script. `options` are the caller's (sprint_2 2.7 content script). */
export function createGcalObserver(options: GcalObserverOptions): GcalObserver {
  const reads = passReads();
  const read = (doc: Document, offsetAt: OffsetAt = options.offsetAt): PassRead => reads(offsetAt)(doc);
  let busyRun: BusyRun | null = null;
  let latest: SnapshotAccount | null = null;
  return Object.freeze({
    id: GCAL_OBSERVER_ID,
    vendor: 'gcal',
    version: GCAL_VERSION,
    hosts: OBSERVER_HOSTS.gcal,
    source: 'gcal.event',
    attributes: GCAL_ATTRIBUTES,
    // The run of busy passes is timed here, on every pass, DEGRADED or not: a pass that is DEGRADED page.busy
    // extracts nothing, so a gap or a clock that went back must still be able to start a new run (SEC-10).
    health: (doc: Document, ctx?: ExtractContext) => {
      const page = read(doc);
      if (!page.busy) busyRun = null;
      if (!page.busy || ctx === undefined) return healthOf(page, busyRun);
      const atMs = instantMs(ctx.observedAt);
      const verdict = healthOf(page, continuedRun(busyRun, atMs));
      busyRun = extendBusyRun(busyRun, atMs);
      return verdict;
    },
    extract: (doc: Document, ctx: ExtractContext) => calendarRows(read(doc, ctx.offsetAt), ctx.observedAt),
    account: (doc: Document) => read(doc).account,
    visibleWindows: (doc: Document, ctx: ExtractContext) => windowsOf(read(doc, ctx.offsetAt), ctx.offsetAt),
    allCalendars: (doc: Document) => allShown(read(doc), doc),
    snapshot: (doc: Document, ctx: ExtractContext) => {
      const page = read(doc, ctx.offsetAt);
      if (page.busy || !page.page.ok) return null;
      const snapshot = snapshotOf(page.page.facts, ctx.observedAt);
      const accountHash = page.account === null ? null : accountHashOf(page.account);
      latest = { at: snapshot.readAt, accountHash };
      return snapshot;
    },
    passAccount: (readAt: string) => (latest?.at === readAt ? latest.accountHash : null),
  });
}
