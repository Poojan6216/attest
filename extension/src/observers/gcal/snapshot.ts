/**
 * A Calendar snapshot: what one clean pass saw of one visible date range (sprint_2 2.5, 2.7), in two forms.
 *
 *  - `CalendarSnapshot`, the page form: what the observer reads (./read.ts, ./pass.ts) and posts as
 *    `calendar.snapshot`. Its events name their guests as written, because a `calendar.updated` row names the first
 *    guest the update added (./diff.ts), which only the new page can tell.
 *  - `StoredSnapshot`, the stored form: what the service worker keeps as a range's comparison base
 *    (src/ledger/calendar-snapshots.ts) and the ledger export carries. Each event keeps its first guest (a deletion's
 *    row names it) and, for every guest, only a key: SHA-256 of the address, ASCII-lowercased (`guestKey`), which is
 *    all a comparison needs. So the store never holds every guest address of every event in clear (SEC-2, Hard Rule 2:
 *    keep what the rows and the diff need, nothing more).
 *
 * Derived facts only (Hard Rule 2). Beside the gcal.event allowlist's fields (subject hint ≤ 80 code points, event
 * start, a guest address), a snapshot holds facts that are not content:
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
 * Every snapshot is parsed with its schema at each boundary: built from the page, received by the service worker,
 * and read back from the ledger. A guest must be one address exactly as `normalize.email` reads it, and a page's
 * guests are listed once per address in ASCII-lowercase order, as ./read.ts lists them.
 *
 * Imports no selectors and no DOM code (TECH-7): the service worker and the ledger load this module.
 */
import { z } from 'zod';

import { asciiLower, email, instantMs } from '../../core/normalize';
import { hashText } from '../../core/redact';
import { ComponentId, IsoTs, SCHEMA_LIMITS, Sha256 } from '../../core/schema';
import { oneLineText } from '../../core/schema-text';
import { dayFromIso } from './days';

const L = SCHEMA_LIMITS;

/** The page form's own version (bump on a shape change; a snapshot of another one is refused by its schema). */
export const SNAPSHOT_FORMAT = 1;

/** The stored form's own version. A stored record of the page form (format 1) is read as its stored form. */
export const STORED_SNAPSHOT_FORMAT = 2;

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

/** One guest: one address, exactly as `normalize.email` reads it (no display name, no angle brackets). */
export const GuestAddress = oneLineText(L.COUNTERPARTY)
  .min(1)
  .refine((text) => email(text)?.address === text, 'expected one email address');

/** The key a stored snapshot keeps for a guest: SHA-256 of the address, ASCII-lowercased (§5.1's fold). */
export function guestKey(address: string): Sha256 {
  return hashText(asciiLower(address));
}

/** Whether each item is strictly after the one before it (so: in order, each once). */
const ascending = (items: readonly string[]): boolean =>
  items.every((item, i) => i === 0 || (items[i - 1] ?? '') < item);

/** The fields both forms of an event share. */
const EventFields = {
  key: Sha256,
  calendar: Sha256,
  subjectHint: oneLineText(L.SUBJECT_HINT).min(1).optional(),
  occurredAt: IsoTs,
  endAt: IsoTs.optional(),
  allDay: z.boolean(),
  days: z.array(DayIso).min(1).max(MAX_RANGE_DAYS),
  /** How many guests the event has, the account left out (more than its list holds when over LIST). */
  guestCount: z.number().int().min(0),
};

/** An event as the page shows it: its guests as written, the account's own left out. */
export const SnapshotEvent = z
  .strictObject({
    ...EventFields,
    /** Guest addresses as written, one per address in ASCII-lowercase order; at most LIST of them. */
    guests: z.array(GuestAddress).max(L.LIST),
  })
  .superRefine((event, ctx) => {
    if (!ascending(event.guests.map(asciiLower)))
      ctx.addIssue({
        code: 'custom',
        path: ['guests'],
        message: 'one per address, in ASCII-lowercase order',
      });
    if (event.guestCount < event.guests.length)
      ctx.addIssue({ code: 'custom', path: ['guestCount'], message: 'below the list' });
  });

/** An event as the store keeps it: its first guest, and every guest's key in ascending order. */
export const StoredEvent = z
  .strictObject({
    ...EventFields,
    /** The event's first guest (the page form's `guests[0]`), the one its rows name. */
    firstGuest: GuestAddress.optional(),
    /** `guestKey` of every guest the page form lists, ascending, each once; at most LIST of them. */
    guestKeys: z.array(Sha256).max(L.LIST),
  })
  .superRefine((event, ctx) => {
    if (!ascending(event.guestKeys))
      ctx.addIssue({ code: 'custom', path: ['guestKeys'], message: 'ascending, each once' });
    if (event.guestCount < event.guestKeys.length)
      ctx.addIssue({ code: 'custom', path: ['guestCount'], message: 'below the list' });
    const first = event.firstGuest;
    if (first === undefined ? event.guestKeys.length > 0 : !event.guestKeys.includes(guestKey(first)))
      ctx.addIssue({ code: 'custom', path: ['firstGuest'], message: 'must be one of the listed guests' });
  });

const SnapshotFields = {
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
};

/** What every snapshot's checks read, in either form. */
interface Frame {
  readonly range: string;
  readonly readAt: string;
  readonly baselineAt: string;
  readonly days: readonly { readonly date: string }[];
  readonly calendars: readonly { readonly key: string; readonly shown: boolean }[];
  readonly events: readonly {
    readonly key: string;
    readonly calendar: string;
    readonly days: readonly string[];
    readonly occurredAt: string;
    readonly endAt?: string | undefined;
  }[];
}

function rangeProblems(snapshot: Frame, ctx: z.RefinementCtx): void {
  if (instantMs(snapshot.baselineAt) > instantMs(snapshot.readAt)) {
    ctx.addIssue({ code: 'custom', path: ['baselineAt'], message: 'after readAt' });
  }
  const first = snapshot.days[0]?.date;
  const last = snapshot.days[snapshot.days.length - 1]?.date;
  if (`${first ?? ''}/${last ?? ''}` !== snapshot.range) {
    ctx.addIssue({ code: 'custom', path: ['range'], message: 'must be the first and last visible day' });
  }
  if (!ascending(snapshot.days.map((day) => day.date))) {
    ctx.addIssue({ code: 'custom', path: ['days'], message: 'must be in order, each once' });
  }
}

function eventProblems(snapshot: Frame, ctx: z.RefinementCtx): void {
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
  });
}

function snapshotProblems(snapshot: Frame, ctx: z.RefinementCtx): void {
  rangeProblems(snapshot, ctx);
  eventProblems(snapshot, ctx);
}

export const CalendarSnapshot = z
  .strictObject({
    format: z.literal(SNAPSHOT_FORMAT),
    ...SnapshotFields,
    events: z.array(SnapshotEvent).max(L.BATCH),
  })
  .superRefine(snapshotProblems);

export const StoredSnapshot = z
  .strictObject({
    format: z.literal(STORED_SNAPSHOT_FORMAT),
    ...SnapshotFields,
    events: z.array(StoredEvent).max(L.BATCH),
  })
  .superRefine(snapshotProblems);

export type CalendarSnapshot = z.infer<typeof CalendarSnapshot>;
export type CalendarSnapshotInput = z.input<typeof CalendarSnapshot>;
export type SnapshotEvent = z.infer<typeof SnapshotEvent>;
export type StoredSnapshot = z.infer<typeof StoredSnapshot>;
export type StoredSnapshotInput = z.input<typeof StoredSnapshot>;
export type StoredEvent = z.infer<typeof StoredEvent>;

/** The stored form of a page event: its first guest in clear, every guest as a key (see the module comment). */
export function storedEventOf(event: SnapshotEvent): StoredEvent {
  const { guests, ...fields } = event;
  const [first] = guests;
  return {
    ...fields,
    ...(first === undefined ? {} : { firstGuest: first }),
    guestKeys: guests.map(guestKey).sort(),
  };
}

/** The stored form of a page snapshot: the same snapshot, each event in its stored form. */
export function storedSnapshotOf(snapshot: CalendarSnapshot): StoredSnapshot {
  return { ...snapshot, format: STORED_SNAPSHOT_FORMAT, events: snapshot.events.map(storedEventOf) };
}
