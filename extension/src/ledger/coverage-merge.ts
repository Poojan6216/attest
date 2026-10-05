/**
 * When two stored coverage intervals may become one (./coverage.ts `recordCoverage`; docs/grading.md §3, §6.1;
 * Decisions [2.7] wave D; Hard Rules 5, 7).
 *
 * Two intervals merge only within one GROUP (`groupKey`): the same observer, source, account, `allCalendars`,
 * `changesSince`, and first-look marker or not. Everything eligibility and caps read is then the same (§6.1), a run
 * of compared Calendar snapshots is never united with a neighbouring range first seen later (v1.9), and a first-look
 * marker (./first-look.ts) never merges with a pass's window, nor a window with a marker, with or without
 * `changesSince` (a marker or an entry that compared nothing never lends its window to one that followed changes).
 *
 * Within a group, a union keeps the earliest start, the latest end and the latest `lastSyncAt` (`unite`). For Gmail
 * that is sound: "by `lastSyncAt` the observer had seen `windowStart..windowEnd`". For Calendar it is not enough. A
 * calendar claim counts a `gcal.event` entry towards full coverage only if the entry synced at or after the claim's
 * `end(p,t) + graceMin` (§6.1, v1.10: a view looked at before the claimed event could have been made cannot say it
 * never was), so a union must never move a `lastSyncAt` over days the later pass did not see: an older week united
 * with a newer neighbouring week would read as seen at the newer sync, a false NOT_FOUND for an event created on the
 * older week in between (Hard Rule 5). So two `gcal.event` intervals merge only when the earlier-synced one's window
 * lies inside the later-synced one's (the union is the later one), or they synced at the same instant (`mergeable`).
 */
import { canonicalJson } from '../core/hash';
import { instantMs } from '../core/normalize';
import { ObserverCoverage } from './types';

/** A coverage entry with its instants read once (core `instantMs`, as grading reads them). */
export interface PlacedEntry {
  readonly entry: ObserverCoverage;
  readonly startMs: number;
  readonly endMs: number;
  readonly syncMs: number;
}

/** A stored row: its outbound key and its parsed entry. */
export interface StoredEntry {
  readonly key: number;
  readonly placed: PlacedEntry;
}

/** IndexedDB keys cannot be undefined: the account-less entries share the key ''. */
export function accountKeyOfEntry(entry: Pick<ObserverCoverage, 'accountHash'>): string {
  return entry.accountHash ?? '';
}

/**
 * Whether `entry` is a first-look marker (./first-look.ts): a `gcal.event` entry over one instant (a point) that
 * began comparing at its own sync (`changesSince` = `lastSyncAt`, as instants). A pass's own window is a run of whole
 * days, never a point, so the shape alone tells the two apart.
 */
export function isFirstLookMarker(entry: ObserverCoverage): boolean {
  const { changesSince } = entry;
  return (
    entry.source === 'gcal.event' &&
    changesSince !== undefined &&
    instantMs(entry.windowStart) === instantMs(entry.windowEnd) &&
    instantMs(changesSince) === instantMs(entry.lastSyncAt)
  );
}

/** The group an entry merges within (see the header). */
export function groupKey(entry: ObserverCoverage): string {
  return canonicalJson([
    entry.observerId,
    entry.source,
    accountKeyOfEntry(entry),
    entry.allCalendars ?? null,
    entry.changesSince ?? null,
    isFirstLookMarker(entry),
  ]);
}

/** Whether `a` and `b` (one group) overlap or touch (closed intervals: a 1 ms gap is never bridged). */
export function touches(a: PlacedEntry, b: PlacedEntry): boolean {
  return a.startMs <= b.endMs && a.endMs >= b.startMs;
}

/**
 * Whether the union of `a` and `b` (one group, touching) says only what each of them said (see the header): always
 * for Gmail; for Calendar, only when they synced at one instant, or the earlier-synced window lies inside the
 * later-synced one.
 */
export function mergeable(a: PlacedEntry, b: PlacedEntry): boolean {
  if (a.entry.source !== 'gcal.event' || a.syncMs === b.syncMs) return true;
  const [earlier, later] = a.syncMs < b.syncMs ? [a, b] : [b, a];
  return earlier.startMs >= later.startMs && earlier.endMs <= later.endMs;
}

/** The union of two intervals of one group that overlap or touch: earliest start, latest end, latest sync. */
export function unite(a: PlacedEntry, b: PlacedEntry): PlacedEntry {
  const start = b.startMs < a.startMs ? b : a;
  const end = b.endMs > a.endMs ? b : a;
  const sync = b.syncMs > a.syncMs ? b : a;
  const entry = ObserverCoverage.parse({
    ...a.entry,
    windowStart: start.entry.windowStart,
    windowEnd: end.entry.windowEnd,
    lastSyncAt: sync.entry.lastSyncAt,
  });
  return { entry, startMs: start.startMs, endMs: end.endMs, syncMs: sync.syncMs };
}

/**
 * `incoming` united with each of `stored` (its group's intervals that touch it, in key order) it may merge with
 * (`mergeable`, checked against the union so far), and the stored intervals it took in. One that may not merge stays
 * as it is: a second interval, never a union that says more than its parts.
 */
export function absorb(
  incoming: PlacedEntry,
  stored: readonly StoredEntry[],
): { readonly union: PlacedEntry; readonly absorbed: readonly StoredEntry[] } {
  let union = incoming;
  const absorbed: StoredEntry[] = [];
  for (const each of stored) {
    if (!touches(union, each.placed) || !mergeable(union, each.placed)) continue;
    union = unite(union, each.placed);
    absorbed.push(each);
  }
  return { union, absorbed };
}
