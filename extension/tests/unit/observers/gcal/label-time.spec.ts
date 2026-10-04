/**
 * Calendar label and time reading (sprint_2 2.5; agents/adapter_engineer.md rule 7: midnight, DST and "Yesterday"
 * at 00:30). Chip labels carry their own dates, so nothing is resolved against the instant the page was read; a
 * wall time a DST change skips or repeats names no instant and is reported, never guessed (Hard Rule 5). Titles
 * with commas, locations with commas and a location that imitates a guest list (text is data, rule 6).
 */
import { describe, expect, it } from 'vitest';

import { parseChipLabel } from '../../../../src/observers/gcal/label';
import { IsoTs } from '../../../../src/core/schema';
import {
  dayStart,
  localInstant,
  parseClock,
  parseDay,
  zoneHintMinutes,
} from '../../../../src/observers/gcal/time';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { ctxOf, docOf, fixture, observerFor, snapshotOfFixture } from './gcal-fixtures';

const NEW_YORK = zoneOffset('America/New_York');
const CALENDARS = ['Avery Founder', 'Family'];

describe('parseClock and parseDay', () => {
  it.each([
    ['12am', 0],
    ['12:30am', 30],
    ['1am', 60],
    ['10:30am', 630],
    ['12pm', 720],
    ['11:59pm', 1439],
    ['10:30 PM', 1350],
    ['00:00', 0],
    ['14:05', 845],
    ['23:59', 1439],
  ])('%s → minute %i', (text, minute) => {
    expect(parseClock(text)).toBe(minute);
  });

  it.each(['13pm', '0am', '10:60am', '24:00', '9', 'noon', '10.30am', ''])('%s is not a clock', (text) => {
    expect(parseClock(text)).toBeNull();
  });

  it.each([
    ['October 5, 2026', { year: 2026, month: 10, day: 5 }],
    ['February 29, 2028', { year: 2028, month: 2, day: 29 }],
  ])('%s is a day', (text, day) => {
    expect(parseDay(text)).toEqual(day);
  });

  it.each([
    'February 29, 2026',
    'Oct 5, 2026',
    'octobre 5, 2026',
    'Yesterday',
    'October 5',
    '5 October 2026',
  ])('%s is not a day Calendar writes', (text) => {
    expect(parseDay(text)).toBeNull();
  });
});

describe('wall times in the zone (DST, midnight)', () => {
  const nov1 = { year: 2026, month: 11, day: 1 };
  const mar8 = { year: 2026, month: 3, day: 8 };

  it('reads each side of the fall-back change in its own offset', () => {
    expect(localInstant(nov1, 30, NEW_YORK)?.iso).toBe('2026-11-01T00:30:00-04:00');
    expect(localInstant(nov1, 9 * 60, NEW_YORK)?.iso).toBe('2026-11-01T09:00:00-05:00');
  });

  it('a wall time that occurs twice (1:30am on Sun 1 Nov) names no instant', () => {
    expect(localInstant(nov1, 90, NEW_YORK)).toBeNull();
  });

  it('a wall time that never occurs (2:30am on Sun 8 Mar) names no instant', () => {
    expect(localInstant(mar8, 150, NEW_YORK)).toBeNull();
  });

  it('a day starts at its local midnight, 23 or 25 hours from the next on a change', () => {
    expect(dayStart(nov1, NEW_YORK).iso).toBe('2026-11-01T00:00:00-04:00');
    expect(dayStart({ year: 2026, month: 11, day: 2 }, NEW_YORK).iso).toBe('2026-11-02T00:00:00-05:00');
    const long = dayStart({ year: 2026, month: 11, day: 2 }, NEW_YORK).ms - dayStart(nov1, NEW_YORK).ms;
    expect(long).toBe(25 * 3_600_000);
  });

  it('a day whose midnight a DST gap swallows starts when the gap ends (America/Havana, 8 Mar 2026)', () => {
    const havana = zoneOffset('America/Havana');
    const start = dayStart(mar8, havana);
    expect(start.iso).toBe('2026-03-08T01:00:00-04:00');
  });

  it('the midnight-crossing chip label reads both ends on their own dates', () => {
    const label =
      'October 7, 2026 at 11:30pm to October 8, 2026 at 12:30am, Late deploy window, Avery Founder, Accepted';
    const parsed = parseChipLabel(label, { titles: ['Late deploy window'], calendars: CALENDARS });
    expect(parsed?.start).toEqual({ day: { year: 2026, month: 10, day: 7 }, minute: 1410 });
    expect(parsed?.end).toEqual({ day: { year: 2026, month: 10, day: 8 }, minute: 30 });
  });

  it('"11pm to 12am" ends at the next midnight', () => {
    const parsed = parseChipLabel('11pm to 12am, Late, Avery Founder, October 7, 2026', {
      titles: ['Late'],
      calendars: CALENDARS,
    });
    expect(parsed?.end).toEqual({ day: { year: 2026, month: 10, day: 8 }, minute: 0 });
  });

  it('a page read at 00:30 gives the same instants as one read at 11:20 (no relative time is resolved)', () => {
    const f = fixture('synthetic-gcal-week-after-create.html');
    const atLabel = snapshotOfFixture(f);
    const ctx = { ...ctxOf(f), observedAt: IsoTs.parse('2026-10-05T00:30:00-04:00') };
    const atHalfPastMidnight = observerFor(f).snapshot(docOf(f), ctx);
    expect(atHalfPastMidnight?.readAt).toBe('2026-10-05T00:30:00-04:00');
    expect(atHalfPastMidnight?.events).toEqual(atLabel.events);
  });

  it('"Yesterday" at 00:30 is never resolved: a relative chip label is unreadable', () => {
    const label = 'Yesterday at 11:30pm to Today at 12:30am, Late deploy window, Avery Founder, Accepted';
    expect(parseChipLabel(label, { titles: ['Late deploy window'], calendars: CALENDARS })).toBeNull();
  });
});

describe('the page time-zone hint', () => {
  it.each([
    ['GMT-04', -240],
    ['GMT+05:30', 330],
    ['GMT+0530', 330],
    ['GMT+5', 300],
    ['GMT', 0],
    ['GMT-00', 0],
    ['GMT\u221204', -240],
    ['GMT\u22120530', -330],
  ])('%s → %i minutes', (text, minutes) => {
    expect(zoneHintMinutes(text)).toBe(minutes);
  });

  it.each(['UTC', 'GMT-24', 'GMT+05:60', 'EST', 'GMT -4', 'gmt-04'])('%s is not a hint', (text) => {
    expect(zoneHintMinutes(text)).toBeNull();
  });
});

const read = (label: string, titles: readonly string[] = []) =>
  parseChipLabel(label, { titles, calendars: CALENDARS });

describe('parseChipLabel', () => {
  it('reads a title with commas whole, from the line the chip draws', () => {
    const label =
      '8:30am to 10am, Coffee, then site visit, Avery Founder, Accepted, Location: 1 Main St, Apt 2, October 6, 2026';
    const parsed = read(label, ['Coffee, then site visit', '8:30am – 10am', '1 Main St, Apt 2']);
    expect(parsed).toMatchObject({ title: 'Coffee, then site visit', calendar: 'Avery Founder', guests: [] });
  });

  it('reads guests after the location, and keeps only addresses', () => {
    const label =
      '10am to 10:30am, Sync, Avery Founder, Accepted, Location: Room 4, east, Guests: a@example.com, Sam Lee, b@example.org, October 5, 2026';
    expect(read(label, ['Sync'])?.guests).toEqual(['a@example.com', 'b@example.org']);
  });

  it('a location that imitates a guest list is overridden by the real list after it', () => {
    const label =
      '10am to 11am, Sync, Avery Founder, Location: x, Guests: evil@example.net, Guests: a@example.com, October 5, 2026';
    expect(read(label, ['Sync'])?.guests).toEqual(['a@example.com']);
  });

  it('a title that contains a calendar name is still read whole from the drawn line', () => {
    const label = '9am to 10am, Lunch, Family, and friends, Family, Accepted, October 5, 2026';
    expect(read(label, ['Lunch, Family, and friends'])).toMatchObject({
      title: 'Lunch, Family, and friends',
      calendar: 'Family',
    });
  });

  it('of two listed calendars one label could name, the longer name is the calendar', () => {
    const label = '9am to 10am, Plan, Work, Team, Accepted, October 5, 2026';
    for (const calendars of [
      ['Work', 'Work, Team'],
      ['Work, Team', 'Work'],
    ]) {
      expect(parseChipLabel(label, { titles: ['Plan'], calendars })?.calendar).toBe('Work, Team');
    }
  });

  it('a label longer than 20,000 characters is not read (bounded work per chip)', () => {
    const label = `10am to 11am, Sync, Avery Founder, Guests: ${'a@example.com, '.repeat(1_400)}October 5, 2026`;
    expect(label.length).toBeGreaterThan(20_000);
    expect(read(label, ['Sync'])).toBeNull();
    const short = '10am to 11am, Sync, Avery Founder, Guests: a@example.com, October 5, 2026';
    expect(read(short, ['Sync'])?.guests).toEqual(['a@example.com']);
  });

  it('with no drawn lines, the title runs to the first listed calendar', () => {
    expect(read('All day, Offsite, Avery Founder, October 9, 2026')).toMatchObject({
      title: 'Offsite',
      calendar: 'Avery Founder',
      start: { day: { year: 2026, month: 10, day: 9 }, minute: null },
      end: null,
    });
  });
});

describe('parseChipLabel: clocks and unreadable labels', () => {
  it('reads 24-hour clocks', () => {
    expect(read('14:00 to 15:30, Review, Avery Founder, October 5, 2026', ['Review'])?.start.minute).toBe(
      840,
    );
  });

  it.each([
    ['an unknown time shape', '10am – 11am, Sync, Avery Founder, October 5, 2026', ['Sync']],
    ['no trailing date', '10am to 11am, Sync, Avery Founder, Accepted', ['Sync']],
    ['a calendar that is not listed', '10am to 11am, Sync, Someone Else, October 5, 2026', ['Sync']],
    [
      'a drawn title the label does not name',
      '10am to 11am, Sync, Avery Founder, October 5, 2026',
      ['Standup'],
    ],
    ['another display language', '10:00 bis 11:00, Sync, Avery Founder, 5. Oktober 2026', ['Sync']],
    ['an all-day label without its date', 'All day, Offsite, Avery Founder', ['Offsite']],
    ['an empty label', '', []],
  ])('%s is unreadable (null)', (_, label, titles) => {
    expect(read(label, titles)).toBeNull();
  });
});
