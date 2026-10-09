/**
 * The coverage level of a claim window (docs/grading.md §6.1). Internal to conditions.ts: import from there.
 * Eligibility and grace are conditions-coverage.ts.
 *
 * Levels are decided per relevant source and then combined: a source is `none` when no eligible interval overlaps
 * the claim window, `full` when the union of its eligible uncapped intervals contains the whole window, else
 * `partial`. The claim is `full` only when every relevant source is full (Attest says NOT_FOUND only after every
 * place the action could appear was seen), `none` when every source is none (always, for a type with no sources),
 * else `partial`.
 *
 * Per claim (they read the claim's own type and time, so never in the eligibility a batch shares, `eligibilityKey`):
 *  - a `calendar.created` claim caps every `gcal.event` entry last synced before `end(p,t) + graceMin`
 *    (`coverage.changes_unfollowed`, v1.10): a view looked at before the event could have been created cannot say
 *    it never was;
 *  - a `calendar.updated` or `calendar.deleted` claim caps every `gcal.event` entry (`coverage.change_unprovable`,
 *    v1.11): Calendar is read as snapshots, so a change made between two looks and then moved, changed again or
 *    removed leaves nothing to compare. A change row a view saw still verifies such a claim; nothing makes it
 *    NOT_FOUND;
 *  - every claim caps each `gmail.sent` entry last synced before its grace sync (`coverage.list_unsettled`, v1.14):
 *    a Sent list read before it shows a send made elsewhere (a reply an agent sent through the API, listed under its
 *    conversation's newest minute once the list refreshes) vouches for a span it has not settled. A send the view
 *    saw still verifies; only NOT_FOUND waits for a view taken after the grace sync.
 * Per source: when the grant binds two or more accounts to it, the source is full only when every bound account's
 * own uncapped entries contain the window (v1.11). A window that only several accounts' views together contain is
 * `partial` with `coverage.account_partial`: one account's view never vouches for another's.
 *
 * Every instant is integer epoch milliseconds; nothing here is a floating-point decision (§5.3).
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import {
  type CapReason,
  type CoverageCap,
  type CoveragePolicy,
  type CoverageResult,
  type EligibleCoverage,
  type EligibleEntry,
  eligibleCoverage,
  graceSyncMs,
  type SourceCoverage,
} from './conditions-coverage';
import { instantMs } from './normalize';
import { firstSeenFromMs } from './order';
import type { CoverageLevel } from './policy';
import type { Claim, Coverage, Grant, ObservationSource } from './schema';
import { claimWindow, type ClaimWindow, isCalendarType } from './window';

/** A `gcal.event` entry synced before a calendar claim's grace sync (§6.1 v1.10). */
const UNFOLLOWED: CoverageCap = 'coverage.changes_unfollowed';
/** Every `gcal.event` entry of a calendar change claim (§6.1 v1.11). */
const UNPROVABLE: CoverageCap = 'coverage.change_unprovable';
/** Every `gcal.event` entry of a `calendar.created` claim whose first-seen bound a clock repair spans (§6.1 v1.16). */
const REPAIRED: CoverageCap = 'coverage.clock_repaired';
/** A `gmail.sent` entry synced before the claim's grace sync (§6.1 v1.14). */
const UNSETTLED: CoverageCap = 'coverage.list_unsettled';
/** A window only several bound accounts' views together contain (§6.1 v1.11). */
const ACCOUNT_PARTIAL: CoverageCap = 'coverage.account_partial';

/** §15 table order. */
const CAP_ORDER: readonly CoverageCap[] = [
  'coverage.calendars_hidden',
  UNFOLLOWED,
  UNPROVABLE,
  REPAIRED,
  UNSETTLED,
  ACCOUNT_PARTIAL,
  'coverage.multiple_accounts',
  'coverage.no_account',
  'coverage.no_parser',
];

/** The union of the closed intervals as sorted, disjoint spans: touching intervals join, a 1 ms gap does not. */
function unionOf(intervals: readonly EligibleEntry[]): (readonly [number, number])[] {
  const spans: [number, number][] = [];
  for (const interval of [...intervals].sort((a, b) => a.startMs - b.startMs)) {
    const last = spans[spans.length - 1];
    if (last !== undefined && interval.startMs <= last[1]) last[1] = Math.max(last[1], interval.endMs);
    else spans.push([interval.startMs, interval.endMs]);
  }
  return spans;
}

/** True iff one of the sorted, disjoint `spans` contains `[fromMs, toMs]`. */
function spansContain(spans: readonly (readonly [number, number])[], fromMs: number, toMs: number): boolean {
  for (const [startMs, endMs] of spans) {
    if (startMs > fromMs) return false;
    if (endMs >= toMs) return true;
  }
  return false;
}

/** True iff the union of the closed intervals contains `[fromMs, toMs]` (a gap of even 1 ms breaks it). */
function covers(intervals: readonly EligibleEntry[], fromMs: number, toMs: number): boolean {
  const ordered = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let reached = fromMs;
  for (const interval of ordered) {
    if (interval.startMs > reached) return false;
    reached = Math.max(reached, interval.endMs);
    if (reached >= toMs) return true;
  }
  return false;
}

/**
 * What a calendar claim asks of each `gcal.event` entry before the entry counts towards full coverage (§6.1).
 * `syncMs`: the entry synced at or after it, `end(p,t) + graceMin` (v1.10). `change`: the claim is a
 * `calendar.updated` or `calendar.deleted`, which no entry covers in full (v1.11).
 */
export interface CalendarBound {
  readonly syncMs: number;
  readonly change: boolean;
  /**
   * `repaired`: the claim is a `calendar.created` whose first-seen bound (§4.1) lies in a clock repair's span (v1.16):
   * either side of the comparison may have been stamped by a clock that ran ahead, so a row first seen after the
   * repair can read as earlier than the claim, and no entry covers it in full (S2-SIM2-1).
   */
  readonly repaired: boolean;
}

/**
 * §6.1: the bound a calendar claim puts on each `gcal.event` entry (`CalendarBound`), null for every other claim. A
 * view last synced before `end(p,t) + graceMin` cannot say the claimed event was never created, and no snapshot
 * reader can say a change was never made, so neither makes a calendar claim's coverage full (Hard Rule 5).
 */
export function calendarBound(
  claim: Claim,
  policy: CoveragePolicy,
  repairs: Coverage['repairs'] = [],
): CalendarBound | null {
  if (!isCalendarType(claim.type)) return null;
  const change = claim.type === 'calendar.updated' || claim.type === 'calendar.deleted';
  const boundMs = firstSeenFromMs(claim, policy);
  const repaired =
    boundMs !== null &&
    repairs.some((repair) => instantMs(repair.from) <= boundMs && boundMs <= instantMs(repair.to));
  return { syncMs: graceSyncMs(claim, policy), change, repaired };
}

/** The cap `bound` puts on `entry`: `UNPROVABLE` for a change claim, `UNFOLLOWED` for a stale view, else null. */
function calendarCap(entry: EligibleEntry, bound: CalendarBound | null): CoverageCap | null {
  if (bound === null || entry.source !== 'gcal.event') return null;
  if (bound.change) return UNPROVABLE;
  if (bound.repaired) return REPAIRED;
  return entry.syncMs < bound.syncMs ? UNFOLLOWED : null;
}

/** The cap a claim's grace sync puts on a `gmail.sent` entry synced before it (§6.1 v1.14), else null. */
function sentCap(entry: EligibleEntry, sentSyncMs: number): CoverageCap | null {
  return entry.source === 'gmail.sent' && entry.syncMs < sentSyncMs ? UNSETTLED : null;
}

/**
 * Whether the uncapped entries contain the window: their union does, and, for a source the grant binds to several
 * accounts (`accounts`), so does each bound account's own. Adds `ACCOUNT_PARTIAL` to `present` when only the union
 * does.
 */
function fullyCovered(
  uncapped: readonly EligibleEntry[],
  window: ClaimWindow,
  accounts: readonly string[] | undefined,
  present: Set<CoverageCap>,
): boolean {
  if (!covers(uncapped, window.fromMs, window.toMs)) return false;
  if (accounts === undefined) return true;
  const own = (account: string) => uncapped.filter((entry) => entry.account === account);
  if (accounts.every((account) => covers(own(account), window.fromMs, window.toMs))) return true;
  present.add(ACCOUNT_PARTIAL);
  return false;
}

function sourceCoverage(
  source: ObservationSource,
  entries: readonly EligibleEntry[],
  window: ClaimWindow | null,
  bound: CalendarBound | null,
  sentSyncMs: number,
  accounts: readonly string[] | undefined,
): SourceCoverage {
  if (window === null) return { source, level: 'none', caps: [] };
  let overlapping = 0;
  const fresh: EligibleEntry[] = [];
  const uncapped: EligibleEntry[] = [];
  const stale: (readonly [EligibleEntry, CoverageCap])[] = [];
  const present = new Set<CoverageCap>();
  for (const entry of entries) {
    if (entry.startMs > window.toMs || entry.endMs < window.fromMs) continue;
    overlapping += 1;
    for (const cap of entry.caps) present.add(cap);
    const cap = calendarCap(entry, bound) ?? sentCap(entry, sentSyncMs);
    if (cap === UNPROVABLE || cap === REPAIRED) present.add(cap);
    else if (cap !== null) stale.push([entry, cap]);
    else {
      fresh.push(entry);
      if (entry.caps.length === 0) uncapped.push(entry);
    }
  }
  // A view synced too early names its cap only for a span no later view saw (v1.14): one a later view contains adds
  // nothing to the window, which is also why the ledger may merge it into that view (src/ledger/coverage-merge.ts).
  // The later views' union is built once per source, not per early view (perf gate, task 1.5).
  if (stale.length > 0) {
    const seen = unionOf(fresh);
    for (const [entry, cap] of stale) {
      if (!spansContain(seen, Math.max(entry.startMs, window.fromMs), Math.min(entry.endMs, window.toMs)))
        present.add(cap);
    }
  }
  if (overlapping === 0) return { source, level: 'none', caps: [] };
  if (fullyCovered(uncapped, window, accounts, present)) return { source, level: 'full', caps: [] };
  return { source, level: 'partial', caps: CAP_ORDER.filter((cap) => present.has(cap)) };
}

function combinedLevel(sources: readonly SourceCoverage[]): CoverageLevel {
  let full = sources.length > 0;
  let none = true;
  for (const source of sources) {
    if (source.level !== 'full') full = false;
    if (source.level !== 'none') none = false;
  }
  if (full) return 'full';
  return none ? 'none' : 'partial';
}

/**
 * §6.1 coverage of the claim window from its eligible entries (a calendar claim with no target has none), with the
 * claim's calendar bound (`calendarBound`, null for a claim of another type) and its grace sync (`graceSyncMs`), which
 * bounds every `gmail.sent` entry (v1.14).
 */
export function coverageFrom(
  eligible: EligibleCoverage,
  window: ClaimWindow | null,
  bound: CalendarBound | null,
  sentSyncMs: number,
): CoverageResult {
  const sources: SourceCoverage[] = [];
  for (const source of eligible.sources) {
    const entries = eligible.entries.get(source) ?? [];
    sources.push(sourceCoverage(source, entries, window, bound, sentSyncMs, eligible.accounts.get(source)));
  }
  const capReasons: CapReason[] = [];
  for (const code of CAP_ORDER) {
    for (const source of sources)
      if (source.caps.includes(code)) capReasons.push({ code, source: source.source });
  }
  return { level: combinedLevel(sources), sources, capReasons };
}

/** §6.1 `coverage`: the level of the claim window, and why it was capped at `partial` (§15). */
export function coverageLevel(
  claim: Claim,
  grant: Grant,
  coverage: Coverage,
  policy: CoveragePolicy,
): CoverageResult {
  const eligible = eligibleCoverage(claim, grant, coverage, policy);
  return coverageFrom(
    eligible,
    claimWindow(claim, policy),
    calendarBound(claim, policy, coverage.repairs),
    graceSyncMs(claim, policy),
  );
}
