/**
 * The Calendar snapshot's two forms (src/observers/gcal/snapshot.ts; SEC-2; Hard Rule 2). A guest is one address
 * exactly as `normalize.email` reads it, listed once per address in ASCII-lowercase order, at every boundary the
 * snapshot crosses (the bus's `calendar.snapshot` message included): free text a page or a broken content script puts
 * there is refused. The stored form keeps each event's first guest and a key per guest, and every labelled fixture's
 * snapshot converts to it.
 */
import { describe, expect, it } from 'vitest';

import { CalendarSnapshotMessage } from '../../../../src/bus/messages';
import {
  CalendarSnapshot,
  type CalendarSnapshotInput,
  guestKey,
  StoredSnapshot,
  storedSnapshotOf,
} from '../../../../src/observers/gcal/snapshot';
import { event, week } from '../../background/calendar-fixtures';
import { GCAL_FIXTURES, snapshotOfFixture } from './gcal-fixtures';

/** The week with one event whose guests are `guests` (as many as listed). */
function withGuests(guests: readonly string[]): CalendarSnapshotInput {
  const base = week([]);
  return { ...base, events: [{ ...event('b'), guests: [...guests], guestCount: guests.length }] };
}

const message = (snapshot: CalendarSnapshotInput) => ({
  type: 'calendar.snapshot',
  observerId: 'gcal.event',
  snapshot,
});

describe('a guest is one address, at every boundary', () => {
  it('accepts addresses as written, one per address, in ASCII-lowercase order', () => {
    const guests = ['amy@example.org', 'Sam.Chen@example.net', 'zed@example.com'];
    expect(CalendarSnapshot.safeParse(withGuests(guests)).success).toBe(true);
    expect(CalendarSnapshotMessage.safeParse(message(withGuests(guests))).success).toBe(true);
  });

  it.each([
    'Dinner with Ottoline at 8, door code 4417',
    'Priya Raman <priya@example.org>',
    ' priya@example.org',
    'priya@example.org, sam@example.net',
    'priya',
  ])('refuses %j, on the bus and in the schema', (guest) => {
    expect(CalendarSnapshot.safeParse(withGuests([guest])).success).toBe(false);
    expect(CalendarSnapshotMessage.safeParse(message(withGuests([guest]))).success).toBe(false);
  });

  it('refuses a guest listed twice (in any ASCII case) and guests out of order', () => {
    expect(CalendarSnapshot.safeParse(withGuests(['amy@example.org', 'AMY@example.org'])).success).toBe(
      false,
    );
    expect(CalendarSnapshot.safeParse(withGuests(['zed@example.com', 'amy@example.org'])).success).toBe(
      false,
    );
  });
});

describe('the stored form', () => {
  it('keeps the first guest and the key of every guest, ascending; nothing else changes', () => {
    const page = CalendarSnapshot.parse(withGuests(['amy@example.org', 'Sam.Chen@example.net']));
    const stored = StoredSnapshot.parse(storedSnapshotOf(page));
    const [before] = page.events;
    const [after] = stored.events;
    if (before === undefined || after === undefined) throw new Error('no event');
    const shared = Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'guests'));
    expect(after).toEqual({
      ...shared,
      firstGuest: 'amy@example.org',
      guestKeys: [guestKey('amy@example.org'), guestKey('sam.chen@example.net')].sort(),
    });
    expect(stored.format).toBe(2);
  });

  it.each(GCAL_FIXTURES.map((f) => [f.file, f] as const))('%s converts to the stored form', (_, f) => {
    const page = snapshotOfFixture(f);
    expect(StoredSnapshot.safeParse(storedSnapshotOf(page)).success).toBe(true);
  });
});
