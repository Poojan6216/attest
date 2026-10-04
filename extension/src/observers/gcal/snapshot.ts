/**
 * A Calendar snapshot: what one clean pass saw of one visible date range (sprint_2 2.5). The diff (./diff.ts)
 * compares the previous snapshot of a range with the current one; storing snapshots in the ledger is sprint_2 2.7.
 *
 * Derived facts only (Hard Rule 2). A snapshot holds what the gcal.event allowlist already lets the ledger keep
 * (subject hint ≤ 80 code points, event start, guest addresses), plus facts that are not content:
 *  - `key`: SHA-256 of the event's `data-eventid` (core `hashRowKey`). The id itself is never kept: Calendar's ids
 *    are base64 of `<event id> <calendar id>`, and the calendar id of a primary calendar is the owner's address,
 *    which leaves the page only as an account hash (src/observers/account.ts). Every row the observer reports
 *    passes this key as its `rowKey`, so a deleted event's row can be built from a stored snapshot alone.
 *  - `calendar`: SHA-256 of the calendar's name (names are personal: "Avery Founder", "Family").
 *  - the days the event's chips sit in, its end, all-day flag, and the visible days (with "N more" days marked).
 * `version` is the selectors' version: a snapshot read under other selectors is never diffed against one read
 * under these (./diff.ts treats it as no previous snapshot). `baselineAt` says since when the range's changes have
 * been followed without a break.
 *
 * Every snapshot is parsed with this schema at the boundary: built from the page (./read.ts) and read back from
 * the ledger (2.7).
 */
import { z } from 'zod';

import { instantMs } from '../../core/normalize';
import { ComponentId, IsoTs, SCHEMA_LIMITS, Sha256 } from '../../core/schema';
import { oneLineText } from '../../core/schema-text';
import { dayFromIso } from './time';

const L = SCHEMA_LIMITS;

/** The snapshot format's own version (bump on a shape change; a stored snapshot of another one is not diffed). */
export const SNAPSHOT_FORMAT = 1;

/** The most days one range may show: six weeks, Calendar's month view. A longer range (year view) is not read. */
export const MAX_RANGE_DAYS = 42;

const DayIso = z.string().refine((text) => dayFromIso(text) !== null, 'expected a YYYY-MM-DD day');

/** `<first day>/<last day>` of the visible range. */
export const RangeKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/u, 'expected first/last day');

export const SnapshotDay = z.strictObject({ date: DayIso, complete: z.boolean() });

/**
 * A listed calendar: the key of its name and whether it is shown. `ambiguous` when the list names it more than once
 * (two calendars with one name): a chip names its calendar only by name, so which of them an event is on, and whether
 * that one was switched on or off, cannot be told; ./diff.ts never creates or deletes on it (Hard Rule 5).
 */
export const SnapshotCalendar = z.strictObject({
  key: Sha256,
  shown: z.boolean(),
  ambiguous: z.literal(true).optional(),
});

export const SnapshotEvent = z.strictObject({
  key: Sha256,
  calendar: Sha256,
  subjectHint: oneLineText(L.SUBJECT_HINT).min(1).optional(),
  occurredAt: IsoTs,
  endAt: IsoTs.optional(),
  allDay: z.boolean(),
  days: z.array(DayIso).min(1).max(MAX_RANGE_DAYS),
  /** Guest addresses as written, the account's own left out, in ASCII-lowercase order; at most LIST of them. */
  guests: z.array(oneLineText(L.COUNTERPARTY).min(1)).max(L.LIST),
  /** How many guests the event has (more than `guests` holds when over LIST). */
  guestCount: z.number().int().min(0),
});

const SnapshotShape = z.strictObject({
  format: z.literal(SNAPSHOT_FORMAT),
  observer: z.literal('gcal.event'),
  version: ComponentId,
  range: RangeKey,
  readAt: IsoTs,
  /**
   * Since when this range's changes have been followed: the `readAt` of the first snapshot of the chain this one
   * continues (same range, account and selectors version), or its own `readAt` when it starts one. A change
   * before it was never comparable (sprint_2 2.7: coverage for calendar.updated and calendar.deleted).
   */
  baselineAt: IsoTs,
  days: z.array(SnapshotDay).min(1).max(MAX_RANGE_DAYS),
  calendars: z.array(SnapshotCalendar).min(1).max(L.LIST),
  events: z.array(SnapshotEvent).max(L.BATCH),
});

function rangeProblems(
  snapshot: { range: string; readAt: string; baselineAt: string; days: readonly { date: string }[] },
  ctx: z.RefinementCtx,
): void {
  if (instantMs(snapshot.baselineAt) > instantMs(snapshot.readAt)) {
    ctx.addIssue({ code: 'custom', path: ['baselineAt'], message: 'after readAt' });
  }
  const first = snapshot.days[0]?.date;
  const last = snapshot.days[snapshot.days.length - 1]?.date;
  if (`${first ?? ''}/${last ?? ''}` !== snapshot.range) {
    ctx.addIssue({ code: 'custom', path: ['range'], message: 'must be the first and last visible day' });
  }
  const dates = snapshot.days.map((day) => day.date);
  if (dates.some((date, i) => i > 0 && (dates[i - 1] ?? '') >= date)) {
    ctx.addIssue({ code: 'custom', path: ['days'], message: 'must be in order, each once' });
  }
}

function eventProblems(snapshot: z.infer<typeof SnapshotShape>, ctx: z.RefinementCtx): void {
  const visible = new Set(snapshot.days.map((day) => day.date));
  const shown = new Set(snapshot.calendars.filter((c) => c.shown).map((c) => c.key));
  const keys = new Set<string>();
  snapshot.events.forEach((event, i) => {
    if (keys.has(event.key))
      ctx.addIssue({ code: 'custom', path: ['events', i, 'key'], message: 'repeated' });
    keys.add(event.key);
    if (!event.days.every((day) => visible.has(day)))
      ctx.addIssue({ code: 'custom', path: ['events', i, 'days'], message: 'outside the range' });
    if (!shown.has(event.calendar))
      ctx.addIssue({ code: 'custom', path: ['events', i, 'calendar'], message: 'not a shown calendar' });
    if (event.endAt !== undefined && instantMs(event.endAt) < instantMs(event.occurredAt))
      ctx.addIssue({ code: 'custom', path: ['events', i, 'endAt'], message: 'before the start' });
    if (event.guestCount < event.guests.length)
      ctx.addIssue({ code: 'custom', path: ['events', i, 'guestCount'], message: 'below the list' });
  });
}

export const CalendarSnapshot = SnapshotShape.superRefine((snapshot, ctx) => {
  rangeProblems(snapshot, ctx);
  eventProblems(snapshot, ctx);
});

export type CalendarSnapshot = z.infer<typeof CalendarSnapshot>;
export type CalendarSnapshotInput = z.input<typeof CalendarSnapshot>;
export type SnapshotEvent = z.infer<typeof SnapshotEvent>;
