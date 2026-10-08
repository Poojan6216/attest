/**
 * The observer contract (build_spec §7 "Adapter contract"; agents/adapter_engineer.md; docs/adapters.md). Types
 * only. A Gmail or Calendar observer implements `Observer`; the skeleton in ./base.ts runs it:
 * `health()` → `extract()` → `redact.project()` → bus.
 *
 * Every function here is pure over the DOM (Hard Rule 3): it reads `doc`, returns data, and never mutates,
 * dispatches, focuses, scrolls, fetches or stores. `attest/no-act` lints all of src/observers/**.
 *
 * Kept apart from ./base.ts so an extractor (`src/observers/<source>/…`) can import the contract without importing
 * the bus, which its lint scope forbids (eslint-rules/fences.js EXTRACTOR_RESTRICTED_IMPORTS).
 */
import type { OffsetAt } from '../core/normalize';
import type { ActionType, IsoTs, ObservationSource } from '../core/schema';

/**
 * What `health()` found. IDLE: the page is not one the observer reads (a Gmail folder other than Sent, no
 * conversation open), so there is nothing to read and nothing is wrong; the ledger keeps the status a page it reads
 * gave (sprint_2 2.11). DEGRADED: a page it reads that it cannot read. Both name at least one reason code
 * (`not_sent_folder`, `selector.missing.row`): lowercase snake_case segments joined by dots, never text the page held
 * (Hard Rules 2, 6). The skeleton adds the observer's id and version and the pass instant to make the stored
 * `HealthReport`.
 */
export type HealthCheck =
  | { readonly status: 'OK' }
  | { readonly status: 'IDLE'; readonly reasons: readonly [string, ...string[]] }
  | { readonly status: 'DEGRADED'; readonly reasons: readonly [string, ...string[]] };

/** What one pass knows besides the page. */
export interface ExtractContext {
  /**
   * The instant this pass read the page (ISO 8601 with offset, from src/clock.ts): every row's `observedAt` (the
   * sighting the ledger keeps, docs/grading.md §3, §10), the coverage ping's `lastSyncAt` and the health report's
   * `checkedAt`. Also the reference instant for vendor-relative times (`normalize.resolveRelative`).
   */
  readonly observedAt: IsoTs;
  /** The user's UTC offset in minutes at an instant, read from the browser (for `normalize.resolveRelative`). */
  readonly offsetAt: OffsetAt;
}

/**
 * build_spec §7, but for `health()`, which returns a `HealthCheck` (the skeleton stamps the id, version and instant),
 * and function-typed members (an object-literal method satisfies them; the skeleton may hold them unbound).
 */
export interface Adapter<T> {
  /** A short token (`gmail.sent`): ComponentId. Bump `version` whenever selectors.json changes. */
  readonly id: string;
  readonly vendor: string;
  readonly version: string;
  /** Exact host permissions (src/config.ts OBSERVER_HOSTS), never a wildcard (Hard Rule 8). */
  readonly hosts: readonly string[];
  /**
   * Runs first, on every pass. DEGRADED → nothing is extracted and no coverage is written (Hard Rules 5, 6). The
   * skeleton also passes the pass's context: most observers read only the page, and the Calendar one times its run of
   * busy passes with `ctx.observedAt` (Decisions [2.close] SEC-10), so that run goes on while the pass is DEGRADED.
   */
  readonly health: (doc: Document, ctx?: ExtractContext) => HealthCheck;
  /** Pure over the DOM; never mutates, never dispatches events (Hard Rule 3). */
  readonly extract: (doc: Document, ctx: ExtractContext) => readonly T[];
}

/**
 * One raw row an observer read. `fields` holds the row's content as plain own data properties (`counterparty`,
 * `subjectHint`, `occurredAt`, `merchant`, …); `redact.project` keeps only those `policy.allowlistedFields[source]`
 * names, so anything else in it never leaves the content script (Hard Rule 2). Names and subjects are one line:
 * collapse whitespace first (./text.ts `oneLine`), or `project` refuses the row and the pass is DEGRADED.
 */
export interface RawRow {
  readonly type: ActionType;
  /** The vendor's own row id, when the page shows one; only its SHA-256 is kept (§10). */
  readonly rowKey?: string | undefined;
  readonly fields: object;
}

/** The span of time one pass could see (docs/grading.md §3), ISO 8601 with offset. */
export interface VisibleWindow {
  readonly windowStart: string;
  readonly windowEnd: string;
}

/**
 * An observer: one source, one coverage stream. A content script that reads two sources (Gmail's Sent list and an
 * opened receipt) runs two observers, each with its own health and coverage.
 *
 * Coverage (docs/grading.md §3; Hard Rule 5): an observer reads its windows with exactly one of `visibleWindow` (one
 * span per pass) or `visibleWindows` (several, or none by design). The skeleton posts one `coverage.ping` per window
 * of a clean pass, each naming this observer's `source`; `src/observers/base.ts` `assertObserver` refuses an
 * observer with both or neither.
 */
export interface Observer extends Adapter<RawRow> {
  readonly source: ObservationSource;
  /**
   * The signed-in account's address as the page shows it (the account switcher's email), or null when the page
   * shows none. Only its SHA-256 leaves the content script (./account.ts). A value that is not an address makes
   * the pass DEGRADED (`account.invalid`); null sends coverage without an account (graded as capped coverage). Read
   * only when the pass has a window or a snapshot to post.
   */
  readonly account: (doc: Document) => string | null;
  /**
   * Every attribute a read of the page depends on (TECH-2): the ones its selectors match on (`role`, `aria-label`,
   * `data-…`; ./batch.ts `selectorAttributes` lists them from selectors.json) and the ones it reads (`title`,
   * `email`, …), the account reader's included. The content script's one MutationObserver watches only these
   * attributes of all its observers, plus the shown-view ones (./batch.ts VIEW_ATTRIBUTES), so a hover or focus change
   * that touches only other attributes starts no pass (one that changes `class`, or an attribute an observer reads,
   * still does; real pages are measured in Sprint 6.4); tree and text changes always do. Absent: every attribute is
   * watched.
   */
  readonly attributes?: readonly string[] | undefined;
  /**
   * The span this pass could see (§3: for a newest-first list whose pass saw its head, `windowEnd` is
   * `ctx.observedAt`; otherwise the newest visible row). Null when the page does not show it: the pass is then
   * DEGRADED (`window.unknown`) and writes no coverage (Hard Rule 5). Only a `gcal.event` window may end after
   * `ctx.observedAt`; any other that does is DEGRADED (`window.future`).
   */
  readonly visibleWindow?: ((doc: Document, ctx: ExtractContext) => VisibleWindow | null) | undefined;
  /**
   * Every span this pass saw whole, each checked as `visibleWindow`'s is, each posted as its own `coverage.ping`
   * (a Calendar range split by a day that hides events; one instant per opened receipt). An empty list is a clean
   * pass that asserts no coverage by design: health OK, its rows, no ping (a Sent page past the head of the list, an
   * opened conversation with no receipt, a Calendar grid still drawing). Null when the observer should know its windows
   * and cannot read them: DEGRADED `window.unknown`, no coverage (Hard Rules 5, 6).
   */
  readonly visibleWindows?:
    ((doc: Document, ctx: ExtractContext) => readonly VisibleWindow[] | null) | undefined;
  /**
   * `gcal.event` only: true when every calendar the page lists is shown, so an event missing from the grid is not
   * one on a calendar switched off (docs/grading.md §6.1: an entry without `allCalendars: true` counts at most as
   * partial). Read once per pass that has a window, and sent on each of its pings. Null when the list cannot be
   * read: DEGRADED `calendars.unknown`, no coverage.
   */
  readonly allCalendars?: ((doc: Document) => boolean | null) | undefined;
  /**
   * `gcal.event` only: the snapshot of the range this pass read (src/observers/gcal/snapshot.ts), which the skeleton
   * posts as `calendar.snapshot` after the pass's observations and coverage, only for a clean pass whose account
   * is known (sprint_2 2.7). Null: nothing to store (the grid was still drawing). Read in the same synchronous read
   * of the page as the rows and the windows, so the snapshot is the page the rows describe.
   */
  readonly snapshot?: ((doc: Document, ctx: ExtractContext) => unknown) | undefined;
}
