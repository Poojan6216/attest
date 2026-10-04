/**
 * The Calendar page reader at its edges (sprint_2 2.5; Hard Rules 2, 5, 6), each on a labelled fixture with one
 * thing changed: guests (the account left out, one per address, at most a list's worth), titles that are not one
 * clean line or say "(No title)", times that run backwards, a chip outside the visible days, more chips than one
 * batch; hidden grids and cells; text that looks like an "N more" control or a zone hint but sits in a chip; a
 * calendar the list names twice; two equal runs of whole days; a stored snapshot read after this pass.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { hashText } from '../../../../src/core/redact';
import { createGcalObserver } from '../../../../src/observers/gcal/observer';
import { CalendarSnapshot } from '../../../../src/observers/gcal/snapshot';
import { planPass } from '../../../../src/observers/plan';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { ctxOf, fixture, htmlOf, parseDocument, snapshotOfFixture } from './gcal-fixtures';

const WEEK = fixture('synthetic-gcal-week-after-create.html');
const TWO = fixture('synthetic-gcal-week-two-calendars.html');
const INVESTOR_GUESTS = 'Investor call, Avery Founder, Accepted, Guests: morgan.patel@example.com';

function edited(base: string, from: string | RegExp, to: string): string {
  const html = base.replace(from, to);
  if (html === base) throw new Error(`the fixture has no ${String(from)}`);
  return html;
}

function observer(f: LabelledFixture, previous: CalendarSnapshot | null = null) {
  return createGcalObserver({ offsetAt: zoneOffset(f.page.timeZone), previous: () => previous });
}

function healthOf(html: string, f: LabelledFixture = WEEK) {
  return observer(f).health(parseDocument(html));
}

function snapshotOf(html: string, f: LabelledFixture = WEEK, previous: CalendarSnapshot | null = null) {
  return observer(f, previous).snapshot(parseDocument(html), ctxOf(f));
}

function eventNamed(snapshot: CalendarSnapshot | null, subject: string) {
  return snapshot?.events.find((e) => e.subjectHint === subject);
}

const UNREADABLE = { status: 'DEGRADED', reasons: ['event.unreadable'] };

describe('gcal.event guests', () => {
  it("the signed-in account is never one of an event's guests, in any ASCII case", () => {
    const html = edited(htmlOf(WEEK), INVESTOR_GUESTS, `${INVESTOR_GUESTS}, Avery.Founder@Example.COM`);
    expect(eventNamed(snapshotOf(html), 'Investor call')?.guests).toEqual(['morgan.patel@example.com']);
  });

  it('one address written twice in two cases is one guest, kept as first written', () => {
    const html = edited(htmlOf(WEEK), INVESTOR_GUESTS, `${INVESTOR_GUESTS}, Morgan.Patel@example.com`);
    expect(eventNamed(snapshotOf(html), 'Investor call')).toMatchObject({
      guests: ['morgan.patel@example.com'],
      guestCount: 1,
    });
  });

  it('more guests than one list holds: the first 200 in order are kept, the count is all of them', () => {
    const many = Array.from({ length: 201 }, (_, i) => `guest${String(i).padStart(3, '0')}@example.com`);
    const html = edited(htmlOf(WEEK), INVESTOR_GUESTS, `${INVESTOR_GUESTS}, ${many.join(', ')}`);
    const investor = eventNamed(snapshotOf(html), 'Investor call');
    expect(investor?.guests).toHaveLength(200);
    expect(investor?.guestCount).toBe(202);
  });
});

describe('gcal.event titles and times', () => {
  it('"(No title)" gives no subject hint, as Gmail\'s "(no subject)" does', () => {
    const snapshot = snapshotOf(htmlOf(WEEK).replaceAll('Board prep', '(No title)'));
    const untitled = snapshot?.events.find((e) => e.occurredAt === '2026-10-08T16:15:00-04:00');
    expect(untitled).toBeDefined();
    expect(untitled?.subjectHint).toBeUndefined();
  });

  it('a title holding a control character is not one line: DEGRADED event.unreadable', () => {
    expect(healthOf(htmlOf(WEEK).replaceAll('Board prep', 'Board\u0007prep'))).toEqual(UNREADABLE);
  });

  it('an end before the start (both written with dates) → DEGRADED event.unreadable', () => {
    const html = htmlOf(WEEK).replaceAll(
      'October 7, 2026 at 11:30pm to October 8, 2026 at 12:30am',
      'October 8, 2026 at 11:30pm to October 7, 2026 at 12:30am',
    );
    expect(healthOf(html)).toEqual(UNREADABLE);
  });

  it('a chip in a day outside the visible days → DEGRADED event.unreadable (never a snapshot that throws)', () => {
    const outside = `<div data-datekey="${String(((2026 - 1970) << 9) | (10 << 5) | 20)}"><div role="button" data-eventid="b3V0c2lkZQ"><div>9am to 10am, Outside, Avery Founder, October 20, 2026</div><div aria-hidden="true"><span>Outside</span></div></div></div>`;
    const html = edited(
      htmlOf(WEEK),
      '<div role="grid" aria-readonly="true"',
      `${outside}<div role="grid" aria-readonly="true"`,
    );
    expect(healthOf(html)).toEqual(UNREADABLE);
  });
});

describe('gcal.event: more chips than one batch', () => {
  it('501 events → DEGRADED event.too_many, nothing read', () => {
    const key = ((2026 - 1970) << 9) | (10 << 5);
    const cells = Array.from({ length: 7 }, (_, i) => {
      const chips =
        i > 0
          ? ''
          : Array.from(
              { length: 501 },
              (_, n) =>
                `<div role="button" data-eventid="e${String(n)}"><div>9am to 10am, E${String(n)}, Me, October 4, 2026</div></div>`,
            ).join('');
      return `<div role="gridcell" data-datekey="${String(key | (4 + i))}">${chips}</div>`;
    });
    const html = `<!doctype html><html><body><div role="complementary"><div role="list"><div role="checkbox" aria-checked="true" aria-label="Me"></div></div></div><div role="main"><div role="grid">${cells.join('')}</div></div></body></html>`;
    expect(healthOf(html)).toEqual({ status: 'DEGRADED', reasons: ['event.too_many'] });
  });
});

describe('gcal.event: hidden structure and look-alike text', () => {
  it('a main whose only grid is hidden → DEGRADED selector.missing.grid', () => {
    const html = edited(
      htmlOf(WEEK),
      '<div role="grid" aria-readonly="true"',
      '<div role="grid" hidden aria-readonly="true"',
    );
    expect(healthOf(html)).toEqual({ status: 'DEGRADED', reasons: ['selector.missing.grid'] });
  });

  it('a hidden day cell of another date inside the shown grid is not a visible day', () => {
    const hiddenCell = `<div role="gridcell" style="display: none" data-datekey="${String(((2026 - 1970) << 9) | (10 << 5) | 20)}"></div>`;
    const html = edited(
      htmlOf(WEEK),
      '<div role="gridcell" data-datekey="29002" class="xOh"></div>',
      `<div role="gridcell" data-datekey="29002" class="xOh"></div>${hiddenCell}`,
    );
    expect(snapshotOf(html)?.range).toBe('2026-10-04/2026-10-10');
  });

  it('a link inside a chip that reads "2 more guests" does not make its day hide events', () => {
    const html = edited(
      htmlOf(WEEK),
      '<div class="oZ">Investor call</div>',
      '<div class="oZ">Investor call</div><a href="#g">2 more guests</a>',
    );
    expect(snapshotOf(html)?.days.every((day) => day.complete)).toBe(true);
  });

  it('an event titled like a zone hint ("GMT+09") is not read as the page\'s zone', () => {
    expect(healthOf(htmlOf(WEEK).replaceAll('Board prep', 'GMT+09'))).toEqual({ status: 'OK' });
  });
});

describe('gcal.event: calendars named twice, equal runs, a later stored snapshot', () => {
  const family =
    /<div role="listitem" class="[^"]*"><div role="checkbox" aria-checked="true" aria-label="Family"[^>]*><\/div><span[^>]*>Family<\/span><\/div>/u;
  const twice = (a: boolean, b: boolean) =>
    `<div role="listitem"><div role="checkbox" aria-checked="${String(a)}" aria-label="Family"></div></div><div role="listitem"><div role="checkbox" aria-checked="${String(b)}" aria-label="Family"></div></div>`;
  const familyChip =
    /<div role="button"[^>]*data-eventid="(?:YmdmMTJq|ZWl0Yms0)[^"]*"[\s\S]*?<\/div><\/div><\/div>/gu;

  it('a calendar the list names twice is marked ambiguous, and switching which one shows deletes nothing', () => {
    const previous = snapshotOf(edited(htmlOf(TWO), family, twice(true, false)), TWO);
    expect(previous?.calendars).toContainEqual({ key: hashText('Family'), shown: true, ambiguous: true });
    const swapped = edited(htmlOf(TWO), family, twice(false, true)).replace(familyChip, '');
    const plan = planPass({
      observer: observer(TWO, previous),
      doc: parseDocument(swapped),
      ctx: ctxOf(TWO),
      policy: DEFAULT_POLICY,
    });
    expect(plan).toMatchObject({ status: 'OK', observations: [] });
  });

  it('two equal runs of whole days: the one window reported is the earlier', () => {
    const html = edited(
      htmlOf(WEEK),
      '<div role="gridcell" data-datekey="28999" class="xOh">',
      '<div role="gridcell" data-datekey="28999" class="xOh"><div role="button">2 more</div>',
    );
    expect(observer(WEEK).visibleWindow(parseDocument(html), ctxOf(WEEK))).toEqual({
      windowStart: '2026-10-04T00:00:00-04:00',
      windowEnd: '2026-10-07T00:00:00-04:00',
    });
  });

  it('a stored snapshot read after this pass: the chain restarts here, never a baseline after the read', () => {
    const before = snapshotOfFixture(fixture('synthetic-gcal-week-before.html'));
    const later = CalendarSnapshot.parse({
      ...before,
      readAt: '2026-10-03T23:00:00-04:00',
      baselineAt: '2026-10-03T22:00:00-04:00',
    });
    expect(snapshotOf(htmlOf(WEEK), WEEK, later)?.baselineAt).toBe(WEEK.page.readAt);
  });
});
