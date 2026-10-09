/**
 * Coverage eligibility and grace (docs/grading.md §6.1, §8). Internal to conditions.ts: import from there. The
 * coverage level of a claim window is conditions-level.ts.
 *
 * An observer entry is ELIGIBLE for a claim when its source is relevant (`policy.sourcesByType[claim.type]`),
 * `lastSyncAt ≤ evaluatedAt`, and its account is acceptable: when `grant.accounts[source]` is set the entry's
 * `accountHash` must be in it; when it is not set, an entry with no `accountHash` and every entry of a source
 * seen with more than one distinct account hash are CAPPED (they count at most as `partial`). A `gcal.event`
 * entry without `allCalendars: true` is capped, and so is a `gmail.receipt` entry for a claim whose normalised
 * counterparty has no receipt parser (`policy.receiptMerchants`; a claim with no counterparty has none). When the
 * grant binds several accounts to a source, each entry keeps its account: one account's view never vouches for
 * another's (`EligibleCoverage.accounts`, v1.11).
 *
 * Capped entries still count for grace: they prove the observer synced.
 *
 * Every instant is integer epoch milliseconds; nothing here is a floating-point decision (§5.3).
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { instantMs, name } from './normalize';
import { compareText } from './order';
import type { CoverageLevel, Policy } from './policy';
import type { Claim, Coverage, Grant, ObservationSource, ObserverCoverage } from './schema';
import { MS_PER_MINUTE } from './units';
import { isCalendarType, precisionBounds } from './window';

/** Why an entry, or a source's view, counts at most as `partial` (§6.1), as its §15 reason code. */
export type CoverageCap =
  | 'coverage.calendars_hidden'
  | 'coverage.changes_unfollowed'
  | 'coverage.change_unprovable'
  | 'coverage.clock_repaired'
  | 'coverage.list_unsettled'
  | 'coverage.account_partial'
  | 'coverage.multiple_accounts'
  | 'coverage.no_account'
  | 'coverage.no_parser';

/** The policy fields coverage and grace read. A loaded `Policy` satisfies it. */
export type CoveragePolicy = Pick<Policy, 'sourcesByType' | 'windows' | 'receiptMerchants'>;

/**
 * One eligible observer entry, in epoch ms. `caps` is empty for an entry that can make coverage full (a calendar
 * claim may still cap it, conditions-level.ts `coverageFrom`). `account` is its `accountHash`, null without one.
 */
export interface EligibleEntry {
  readonly source: ObservationSource;
  readonly startMs: number;
  readonly endMs: number;
  readonly syncMs: number;
  readonly account: string | null;
  readonly caps: readonly CoverageCap[];
}

/** A claim's relevant sources, in policy order, each with its eligible entries. */
export interface EligibleCoverage {
  readonly sources: readonly ObservationSource[];
  readonly entries: ReadonlyMap<ObservationSource, readonly EligibleEntry[]>;
  /**
   * The sources whose grant binds two or more distinct accounts, each with those accounts in code-unit order: such a
   * source is full only when every bound account's own entries are (§6.1 v1.11). Absent for every other source.
   */
  readonly accounts: ReadonlyMap<ObservationSource, readonly string[]>;
  readonly evaluatedMs: number;
}

export interface SourceCoverage {
  readonly source: ObservationSource;
  readonly level: CoverageLevel;
  /** Distinct, in §15 order; non-empty only when `level` is `partial` and a cap held over the window. */
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
  if (held !== undefined) {
    const [sync, start, end] = held.texts;
    if (sync === entry.lastSyncAt && start === entry.windowStart && end === entry.windowEnd) return held;
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
    return [{ source, startMs, endMs, syncMs, account: entry.accountHash ?? null, caps }];
  });
}

/**
 * §6.1 (v1.11): the sources of `sources` whose grant binds two or more distinct accounts, each with those accounts
 * in code-unit order. A view of one bound account never vouches for another's calendars or mail.
 */
function boundAccounts(
  sources: readonly ObservationSource[],
  grant: Grant,
): ReadonlyMap<ObservationSource, readonly string[]> {
  const accounts = new Map<ObservationSource, readonly string[]>();
  for (const source of sources) {
    const bound = [...new Set(grant.accounts?.[source] ?? [])].sort(compareText);
    if (bound.length > 1) accounts.set(source, bound);
  }
  return accounts;
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
  return { sources, entries, accounts: boundAccounts(sources, grant), evaluatedMs };
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
