/**
 * Coverage eligibility, coverage level and grace (docs/grading.md §6.1, §8). Internal to conditions.ts: import
 * from there.
 *
 * An observer entry is ELIGIBLE for a claim when its source is relevant (`policy.sourcesByType[claim.type]`),
 * `lastSyncAt ≤ evaluatedAt`, and its account is acceptable: when `grant.accounts[source]` is set the entry's
 * `accountHash` must be in it; when it is not set, an entry with no `accountHash` and every entry of a source
 * seen with more than one distinct account hash are CAPPED (they count at most as `partial`). A `gcal.event`
 * entry without `allCalendars: true` is capped, and so is a `gmail.receipt` entry for a claim whose normalised
 * counterparty has no receipt parser (`policy.receiptMerchants`; a claim with no counterparty has none).
 *
 * Levels are decided per relevant source and then combined: a source is `none` when no eligible interval
 * overlaps the claim window, `full` when the union of its eligible uncapped intervals contains the whole window,
 * else `partial`. The claim is `full` only when every relevant source is full (Attest says NOT_FOUND only after
 * every place the action could appear was seen), `none` when every source is none (always, for a type with no
 * sources), else `partial`. Capped entries still count for grace: they prove the observer synced.
 *
 * Every instant is integer epoch milliseconds; nothing here is a floating-point decision (§5.3).
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { instantMs, name } from './normalize';
import type { CoverageLevel, Policy } from './policy';
import type { Claim, Coverage, Grant, ObservationSource, ObserverCoverage } from './schema';
import { MS_PER_MINUTE } from './units';
import { claimWindow, type ClaimWindow, isCalendarType, precisionBounds } from './window';

/** Why an entry counts at most as `partial` (§6.1), as its §15 reason code. */
export type CoverageCap =
  'coverage.calendars_hidden' | 'coverage.multiple_accounts' | 'coverage.no_account' | 'coverage.no_parser';

/** §15 table order. */
const CAP_ORDER: readonly CoverageCap[] = [
  'coverage.calendars_hidden',
  'coverage.multiple_accounts',
  'coverage.no_account',
  'coverage.no_parser',
];

/** The policy fields coverage and grace read. A loaded `Policy` satisfies it. */
export type CoveragePolicy = Pick<Policy, 'sourcesByType' | 'windows' | 'receiptMerchants'>;

/** One eligible observer entry, in epoch ms. `caps` is empty for an entry that can make coverage full. */
export interface EligibleEntry {
  readonly source: ObservationSource;
  readonly startMs: number;
  readonly endMs: number;
  readonly syncMs: number;
  readonly caps: readonly CoverageCap[];
}

/** A claim's relevant sources, in policy order, each with its eligible entries. */
export interface EligibleCoverage {
  readonly sources: readonly ObservationSource[];
  readonly entries: ReadonlyMap<ObservationSource, readonly EligibleEntry[]>;
  readonly evaluatedMs: number;
}

export interface SourceCoverage {
  readonly source: ObservationSource;
  readonly level: CoverageLevel;
  /** Distinct, in §15 order; non-empty only when `level` is `partial` and a capped entry overlaps the window. */
  readonly caps: readonly CoverageCap[];
}

/** One coverage-capping reason (§15): the cap and the source it capped. */
export interface CapReason {
  readonly code: CoverageCap;
  readonly source: ObservationSource;
}

export interface CoverageResult {
  readonly level: CoverageLevel;
  /** Every relevant source, in policy order. */
  readonly sources: readonly SourceCoverage[];
  /** The caps of the partial sources, ordered by code (§15 table order), then by source (policy order). */
  readonly capReasons: readonly CapReason[];
}

/** One relevant source and whether its grace has elapsed (§6.1 `graceElapsed`). */
export interface SourceGrace {
  readonly source: ObservationSource;
  readonly elapsed: boolean;
}

interface AccountRule {
  /** `grant.accounts[source]`: when set, the only acceptable account hashes. */
  readonly bound: readonly string[] | undefined;
  /** The source was seen with more than one distinct account hash. */
  readonly multiple: boolean;
}

/** An entry's instants in epoch ms, with the texts they were parsed from. */
export interface EntryInstants {
  readonly texts: readonly [lastSyncAt: string, windowStart: string, windowEnd: string];
  readonly syncMs: number;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Parsed instants per entry object. One coverage object is read for every claim of a batch, and ISO parsing
 * dominates eligibility; the memo is keyed by object identity, weakly held, and used only while the entry still
 * holds the texts it was parsed from, so an entry edited in place is re-read, never stale (as candidates-time.ts).
 */
const ENTRY_INSTANTS = new WeakMap<ObserverCoverage, EntryInstants>();

/** `entry`'s `lastSyncAt`, `windowStart` and `windowEnd` as epoch ms, parsed once per object and text. */
export function entryInstants(entry: ObserverCoverage): EntryInstants {
  const held = ENTRY_INSTANTS.get(entry);
  const [sync, start, end] = held?.texts ?? [];
  if (
    held !== undefined &&
    sync === entry.lastSyncAt &&
    start === entry.windowStart &&
    end === entry.windowEnd
  ) {
    return held;
  }
  const parsed: EntryInstants = {
    texts: [entry.lastSyncAt, entry.windowStart, entry.windowEnd],
    syncMs: instantMs(entry.lastSyncAt),
    startMs: instantMs(entry.windowStart),
    endMs: instantMs(entry.windowEnd),
  };
  ENTRY_INSTANTS.set(entry, parsed);
  return parsed;
}

/** §6.1: a purchase is covered by a receipt parser only when its normalised counterparty has one. */
function hasReceiptParser(claim: Claim, policy: CoveragePolicy): boolean {
  return claim.counterparty !== undefined && policy.receiptMerchants.includes(name(claim.counterparty));
}

/** The entry's caps in §15 order, or null when its account is not acceptable (the entry is not eligible). */
function entryCaps(entry: ObserverCoverage, account: AccountRule, noParser: boolean): CoverageCap[] | null {
  const caps: CoverageCap[] = [];
  if (entry.source === 'gcal.event' && entry.allCalendars !== true) caps.push('coverage.calendars_hidden');
  if (account.bound === undefined) {
    if (account.multiple) caps.push('coverage.multiple_accounts');
    if (entry.accountHash === undefined) caps.push('coverage.no_account');
  } else if (entry.accountHash === undefined || !account.bound.includes(entry.accountHash)) {
    return null;
  }
  if (noParser && entry.source === 'gmail.receipt') caps.push('coverage.no_parser');
  return caps;
}

/** The eligible entries of one source. The account count reads every entry of the source synced by now (§6.1). */
function sourceEntries(
  source: ObservationSource,
  coverage: Coverage,
  evaluatedMs: number,
  grant: Grant,
  noParser: boolean,
): EligibleEntry[] {
  const seen = coverage.observers.filter(
    (entry) => entry.source === source && entryInstants(entry).syncMs <= evaluatedMs,
  );
  const hashes = new Set(
    seen.flatMap((entry) => (entry.accountHash === undefined ? [] : [entry.accountHash])),
  );
  const account: AccountRule = { bound: grant.accounts?.[source], multiple: hashes.size > 1 };
  return seen.flatMap((entry) => {
    const caps = entryCaps(entry, account, noParser);
    if (caps === null) return [];
    const { startMs, endMs, syncMs } = entryInstants(entry);
    return [{ source, startMs, endMs, syncMs, caps }];
  });
}

/**
 * Everything `eligibleCoverage` reads of a claim, as one key: its type and, only when a relevant source is
 * `gmail.receipt` (the one source the no-parser cap applies to), whether it has a receipt parser. Two claims with
 * one key have the same eligible coverage under one grant, coverage and policy.
 */
export function eligibilityKey(claim: Claim, policy: CoveragePolicy): string {
  const parsed =
    policy.sourcesByType[claim.type].includes('gmail.receipt') && hasReceiptParser(claim, policy);
  return parsed ? `${claim.type} parser` : claim.type;
}

/** §6.1 eligibility of every entry for `claim`, grouped by relevant source. */
export function eligibleCoverage(
  claim: Claim,
  grant: Grant,
  coverage: Coverage,
  policy: CoveragePolicy,
): EligibleCoverage {
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const sources = policy.sourcesByType[claim.type];
  const noParser = !hasReceiptParser(claim, policy);
  const entries = new Map(
    sources.map((source) => [source, sourceEntries(source, coverage, evaluatedMs, grant, noParser)] as const),
  );
  return { sources, entries, evaluatedMs };
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

function sourceCoverage(
  source: ObservationSource,
  entries: readonly EligibleEntry[],
  window: ClaimWindow | null,
): SourceCoverage {
  if (window === null) return { source, level: 'none', caps: [] };
  const overlapping: EligibleEntry[] = [];
  const uncapped: EligibleEntry[] = [];
  for (const entry of entries) {
    if (entry.startMs > window.toMs || entry.endMs < window.fromMs) continue;
    overlapping.push(entry);
    if (entry.caps.length === 0) uncapped.push(entry);
  }
  if (overlapping.length === 0) return { source, level: 'none', caps: [] };
  if (covers(uncapped, window.fromMs, window.toMs)) return { source, level: 'full', caps: [] };
  const present = new Set<CoverageCap>();
  for (const entry of overlapping) for (const cap of entry.caps) present.add(cap);
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

/** §6.1 coverage of the claim window from its eligible entries (a calendar claim with no target has none). */
export function coverageFrom(eligible: EligibleCoverage, window: ClaimWindow | null): CoverageResult {
  const sources: SourceCoverage[] = [];
  for (const source of eligible.sources) {
    sources.push(sourceCoverage(source, eligible.entries.get(source) ?? [], window));
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
  return coverageFrom(eligibleCoverage(claim, grant, coverage, policy), claimWindow(claim, policy));
}

/** `end(p,t) + graceMin`: the sync that finalises a VERIFIED receipt (§8). */
export function verifiedSyncMs(claim: Claim, policy: CoveragePolicy): number {
  return precisionBounds(claim).endMs + policy.windows.graceMin * MS_PER_MINUTE;
}

/** §6.1 `graceElapsed`: `end(p,t) + graceMin` and, for non-calendar types, also `end(p,t) + afterClaimMin`. */
export function graceSyncMs(claim: Claim, policy: CoveragePolicy): number {
  const graceMs = verifiedSyncMs(claim, policy);
  if (isCalendarType(claim.type)) return graceMs;
  return Math.max(graceMs, precisionBounds(claim).endMs + policy.windows.afterClaimMin * MS_PER_MINUTE);
}

/** For each relevant source: has an eligible entry (capped or not) synced at or after `syncMs`? */
export function syncedSources(eligible: EligibleCoverage, syncMs: number): SourceGrace[] {
  const out: SourceGrace[] = [];
  for (const source of eligible.sources) {
    let elapsed = false;
    for (const entry of eligible.entries.get(source) ?? []) {
      if (entry.syncMs >= syncMs) {
        elapsed = true;
        break;
      }
    }
    out.push({ source, elapsed });
  }
  return out;
}

/** True iff every relevant source has synced at or after `syncMs`; vacuously true with no sources. */
export function everySourceSynced(eligible: EligibleCoverage, syncMs: number): boolean {
  return syncedSources(eligible, syncMs).every((source) => source.elapsed);
}

/**
 * §6.1 `graceElapsed`: every relevant source has an eligible entry that synced after the whole claim window could
 * have happened. The clock is the observers' sync time, never a wall clock. Vacuously true with no sources.
 */
export function graceElapsed(
  claim: Claim,
  grant: Grant,
  coverage: Coverage,
  policy: CoveragePolicy,
): boolean {
  return everySourceSynced(eligibleCoverage(claim, grant, coverage, policy), graceSyncMs(claim, policy));
}
