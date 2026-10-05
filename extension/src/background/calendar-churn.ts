/**
 * At most CHURN_LIMIT stored `calendar.updated` rows per Calendar event per CHURN_WINDOW_MS (SEC-11; docs/grading.md
 * §3 v1.12; Hard Rules 5, 6). PURE: no DOM, no clock, no I/O.
 *
 * Every state of an event is its own row (its own contentHash), so every edit a pass sees is a new
 * `calendar.updated` row. Anyone who organises an event on the user's calendar can edit it by script while the
 * user's Calendar tab is open and read every minute (or every two seconds while the page keeps changing), and each
 * edit would be one more row kept for 90 days, all in one time bucket. So the service worker counts, per event and in
 * the range's record (src/ledger/calendar-snapshots.ts `updates`), the update rows its range reported since the first
 * one of the current window. Once CHURN_LIMIT are counted, the event's further updates in that window are not stored
 * (coalesced): the range's base still moves to the event's new state, so the next change is compared with what the
 * page last showed, and the pass says how many it held back so the service worker can report the observer DEGRADED
 * `ledger.event_churn` (Hard Rule 6: a row held back is never silent). A window ends CHURN_WINDOW_MS after its first
 * row (or when the clock went back past it); the next update starts a new one. A creation, a deletion and a first
 * sighting are never held back: each is at most one row per event state, and the evidence a claim may need.
 *
 * What a held-back update costs (docs/grading.md §6.1): a `calendar.updated` claim it would have verified has no row.
 * Such a claim is never NOT_FOUND (v1.11, `coverage.change_unprovable`): it is UNVERIFIABLE once it finalises.
 */
import { instantMs } from '../core/normalize';
import { type IsoTs, Sha256 } from '../core/schema';
import { MS_PER_MINUTE } from '../core/units';
import type { UpdateWindow } from '../ledger/calendar-snapshots';
import type { RawRow } from '../observers/types';

/** The most `calendar.updated` rows stored for one event in one window. */
export const CHURN_LIMIT = 20;

/** How long a window lasts from its first row: a day. */
export const CHURN_WINDOW_MS = 24 * 60 * MS_PER_MINUTE;

export interface CappedRows {
  /** `rows` less the updates held back, in their order. */
  readonly rows: readonly RawRow[];
  /** Every window still open after this pass, for an event of `present`, by key. */
  readonly updates: readonly UpdateWindow[];
  /** How many update rows were held back (0: none). */
  readonly heldBack: number;
}

/** `window` when it is still open at `readAt` (it began at most CHURN_WINDOW_MS before it, and not after it). */
function open(window: UpdateWindow | undefined, readAt: IsoTs): UpdateWindow | undefined {
  if (window === undefined) return undefined;
  const age = instantMs(readAt) - instantMs(window.since);
  return age >= 0 && age < CHURN_WINDOW_MS ? window : undefined;
}

/**
 * The rows of a pass read at `readAt` that may be stored, and the windows to store with the range's next base
 * (`present`: the keys of its events). `windows` are the stored record's.
 */
export function capUpdates(
  rows: readonly RawRow[],
  windows: readonly UpdateWindow[],
  readAt: IsoTs,
  present: ReadonlySet<string>,
): CappedRows {
  const byKey = new Map<string, UpdateWindow>(windows.map((window) => [window.key, window]));
  const kept: RawRow[] = [];
  let heldBack = 0;
  for (const row of rows) {
    const key = Sha256.safeParse(row.rowKey);
    if (row.type !== 'calendar.updated' || !key.success) {
      kept.push(row);
      continue;
    }
    const current = open(byKey.get(key.data), readAt);
    if (current !== undefined && current.count >= CHURN_LIMIT) {
      heldBack += 1;
      continue;
    }
    const count = (current?.count ?? 0) + 1;
    byKey.set(key.data, { key: key.data, since: current?.since ?? readAt, count });
    kept.push(row);
  }
  const updates = [...byKey.values()]
    .filter((window) => present.has(window.key) && open(window, readAt) !== undefined)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rows: kept, updates, heldBack };
}
