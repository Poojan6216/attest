/**
 * The Calendar observer on hostile and drifted variants of its labelled fixtures (sprint_2 2.5 verification; Hard
 * Rules 5, 6): reordered attributes, an `aria-label` chip, odd white space, right-to-left titles; a hidden earlier
 * view kept in the DOM, two shown views, a year view, a week split over two grids; "N more" written as a native
 * button or "+2 more", or in no day; a secondary time zone; a label whose date is after its chip's day; a second
 * account and a page with no account. A view Attest did not really see is never reported as seen, and a page it
 * cannot read for certain is DEGRADED, never guessed.
 */
import { describe, expect, it } from 'vitest';

import { asciiLower } from '../../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { hashRowKey, hashText } from '../../../../src/core/redact';
import { accountHashOf } from '../../../../src/observers/account';
import { diffSnapshots } from '../../../../src/observers/gcal/diff';
import { createGcalObserver, type GcalObserver } from '../../../../src/observers/gcal/observer';
import type { CalendarSnapshot } from '../../../../src/observers/gcal/snapshot';
import { planPass } from '../../../../src/observers/plan';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { ctxOf, fixture, htmlOf, parseDocument, snapshotOfFixture } from './gcal-fixtures';

const WEEK = fixture('synthetic-gcal-week-after-create.html');
const MONTH = fixture('synthetic-gcal-month-november.html');
const MAIN_OPEN = '<div class="OP Hor7Q yd" role="main">';
const GRID_OPEN = '<div role="grid" aria-readonly="true" class="omq">';
const MORE_BUTTON =
  '<div role="button" tabindex="0" class="smx D2c0NE eowk"><span class="HvUYp t4IC8Y VR">2 more events, November 12, 2026</span><span aria-hidden="true">2 more</span></div>';

function edited(base: string, from: string | RegExp, to: string): string {
  const html = base.replace(from, to);
  if (html === base) throw new Error(`the fixture has no ${String(from)}`);
  return html;
}

/** `data-datekey` of a day. */
function key(year: number, month: number, day: number): number {
  return ((year - 1970) << 9) | (month << 5) | day;
}

/** A grid of the week before the fixture's (Sun 27 Sep to Sat 3 Oct 2026), optionally with one event chip. */
function earlierWeekGrid(withChip: boolean): string {
  const days = [27, 28, 29, 30].map((d) => key(2026, 9, d)).concat([1, 2, 3].map((d) => key(2026, 10, d)));
  const chip =
    '<div role="button" data-eventid="c3RhbGUgYXZlcnkuZm91bmRlckBleGFtcGxlLmNvbQ"><div>9am to 10am, Old event, Avery Founder, Accepted, September 29, 2026</div><div aria-hidden="true"><span>Old event</span></div></div>';
  const cells = days.map(
    (k, i) => `<div role="gridcell" data-datekey="${String(k)}">${withChip && i === 2 ? chip : ''}</div>`,
  );
  return `<div role="grid">${cells.join('')}</div>`;
}

interface Run {
  readonly plan: ReturnType<typeof planPass>;
  readonly snapshot: CalendarSnapshot | null;
  readonly observer: GcalObserver;
}

function run(html: string, f: LabelledFixture = WEEK, timeZone = f.page.timeZone): Run {
  const offsetAt = zoneOffset(timeZone);
  const observer = createGcalObserver({ offsetAt });
  const ctx = { ...ctxOf(f), offsetAt };
  const plan = planPass({ observer, doc: parseDocument(html), ctx, policy: DEFAULT_POLICY });
  return { plan, snapshot: observer.snapshot(parseDocument(html), ctx), observer };
}

/** The snapshot's events as the labels write them (key, calendar hash, subject, start, all-day, guests). */
function eventsOf(snapshot: CalendarSnapshot | null): string[] {
  return (snapshot?.events ?? [])
    .map((e) => JSON.stringify([e.key, e.calendar, e.subjectHint, e.occurredAt, e.allDay, e.guests]))
    .sort();
}

function labelledEvents(f: LabelledFixture, rename: (subject: string) => string = (s) => s): string[] {
  return f.events
    .map((e) => {
      const guests = [...e.attendees].sort((a, b) => (asciiLower(a) < asciiLower(b) ? -1 : 1));
      const event = [hashRowKey(e.rowKey), hashText(e.calendar), rename(e.subjectHint), e.occurredAt];
      return JSON.stringify([...event, e.allDay, guests]);
    })
    .sort();
}

function coverageOf(plan: Run['plan']): [string, string][] | null {
  return plan.status === 'OK' ? plan.coverage.map((c) => [c.windowStart, c.windowEnd]) : null;
}

const WEEK_WINDOW: [string, string][] = [['2026-10-04T00:00:00-04:00', '2026-10-11T00:00:00-04:00']];

describe('gcal.event reads drifted markup the same way', () => {
  it('reordered attributes, an aria-label on the chip, and odd white space in labels', () => {
    let html = edited(
      htmlOf(WEEK),
      /<div role="button" tabindex="0" data-eventchip="" (data-eventid="cDdi[^"]*") class="[^"]*" style="[^"]*"><div class="[^"]*">([^<]*)<\/div>/u,
      '<div $1 class="zz" aria-label="$2" tabindex="0" role="button" data-eventchip=""><div class="a">IGNORED</div>',
    );
    html = edited(
      html,
      '10am to 10:30am, Weekly sync, Avery Founder,',
      '10am to 10:30 am,\n   Weekly   sync, Avery Founder,\t',
    );
    const { plan, snapshot } = run(html);
    expect(plan.status).toBe('OK');
    expect(eventsOf(snapshot)).toEqual(labelledEvents(WEEK));
  });

  it('a right-to-left title (with a right-to-left mark) is read whole, as written', () => {
    const title = 'פגישה ‏עם הצוות';
    const { plan, snapshot } = run(htmlOf(WEEK).replaceAll('Board prep', title));
    expect(plan.status).toBe('OK');
    expect(eventsOf(snapshot)).toEqual(labelledEvents(WEEK, (s) => (s === 'Board prep' ? title : s)));
  });
});

describe('gcal.event reads only the view the user sees (Hard Rule 5)', () => {
  it('a hidden earlier view kept before the shown one is never read', () => {
    for (const hidden of ['hidden', 'style="display: none"']) {
      const stale = `<div role="main" ${hidden}>${earlierWeekGrid(true)}</div>`;
      const { plan, snapshot } = run(edited(htmlOf(WEEK), MAIN_OPEN, `${stale}${MAIN_OPEN}`));
      expect(coverageOf(plan)).toEqual(WEEK_WINDOW);
      expect(snapshot?.range).toBe('2026-10-04/2026-10-10');
      expect(eventsOf(snapshot)).toEqual(labelledEvents(WEEK));
    }
  });

  it('a hidden grid of the earlier week inside the shown main is never read', () => {
    const stale = `<div style="display:none">${earlierWeekGrid(true)}</div>`;
    const { plan, snapshot } = run(edited(htmlOf(WEEK), GRID_OPEN, `${stale}${GRID_OPEN}`));
    expect(coverageOf(plan)).toEqual(WEEK_WINDOW);
    expect(eventsOf(snapshot)).toEqual(labelledEvents(WEEK));
  });

  it('two shown main regions → DEGRADED selector.ambiguous.main, nothing read', () => {
    const other = `<div role="main">${earlierWeekGrid(false)}</div>`;
    const { plan } = run(edited(htmlOf(WEEK), MAIN_OPEN, `${other}${MAIN_OPEN}`));
    expect(plan).toEqual({ status: 'DEGRADED', reasons: ['selector.ambiguous.main'], observations: [] });
  });

  it('a year view (one grid per month, no events) → DEGRADED range.too_long, never "January seen"', () => {
    const months = Array.from({ length: 12 }, (_, m) => {
      const length = new Date(Date.UTC(2026, m + 1, 0)).getUTCDate();
      const cells = Array.from(
        { length },
        (_, d) => `<div role="gridcell" data-datekey="${String(key(2026, m + 1, d + 1))}"></div>`,
      );
      return `<div role="grid">${cells.join('')}</div>`;
    });
    const html = edited(htmlOf(WEEK), /<div class="OP Hor7Q yd" role="main">[\s\S]*$/u, '');
    const { plan } = run(`${html}<div role="main">${months.join('')}</div></div></div></body></html>`);
    expect(plan).toEqual({ status: 'DEGRADED', reasons: ['range.too_long'], observations: [] });
  });

  it('a week drawn as two grids (all-day and timed) is one range', () => {
    const html = edited(
      htmlOf(WEEK),
      '<div role="row" class="d4">',
      `</div>${GRID_OPEN}<div role="row" class="d4">`,
    );
    const { plan, snapshot } = run(html);
    expect(coverageOf(plan)).toEqual(WEEK_WINDOW);
    expect(eventsOf(snapshot)).toEqual(labelledEvents(WEEK));
  });
});

describe('gcal.event: days that hide events, zones, dates', () => {
  const twoWindows = MONTH.coverage.map((c) => [c.windowStart, c.windowEnd]);

  it.each([
    [
      'a native <button>',
      '<button><span>2 more events</span><span aria-hidden="true">2 more</span></button>',
    ],
    ['"+2 more" text', '<div role="button"><span aria-hidden="true">+2 more</span></div>'],
    ['a link', '<a href="#more">2 more</a>'],
  ])('"N more" written as %s still leaves its day out', (_, control) => {
    const html = edited(htmlOf(MONTH), MORE_BUTTON, control);
    const observer = createGcalObserver({ offsetAt: zoneOffset(MONTH.page.timeZone) });
    const windows = observer.visibleWindows(parseDocument(html), ctxOf(MONTH));
    expect(windows?.map((w) => [w.windowStart, w.windowEnd])).toEqual(twoWindows);
  });

  it('an event moved onto the "2 more" day, where it is hidden, is not deleted', () => {
    const quarterly =
      /<div role="button" tabindex="0" data-eventchip="" data-eventid="YWI3Z21ldGVrM2c0cWU2bnZ0dW9sb3JlZG4gYXZlcnkuZm91bmRlckBleGFtcGxlLmNvbQ"[\s\S]*?Quarterly planning<\/span><\/div><\/div>/u;
    const moved = edited(htmlOf(MONTH), quarterly, '');
    const { plan, snapshot } = run(moved, MONTH);
    expect(plan.status).toBe('OK');
    if (snapshot === null) throw new Error('no snapshot');
    // What the service worker's diff makes of it, against the month as drawn before: no change at all.
    expect(diffSnapshots(snapshotOfFixture(MONTH), snapshot)).toEqual({ changes: [], sightings: [] });
  });

  it('an "N more" control in no day: no day is whole, so the pass reports no window (DEGRADED)', () => {
    const monthGrid = '<div role="grid" aria-readonly="true" class="ETO">';
    const stray = edited(edited(htmlOf(MONTH), MORE_BUTTON, ''), monthGrid, `${MORE_BUTTON}${monthGrid}`);
    const { plan } = run(stray, MONTH);
    expect(plan.status).toBe('DEGRADED');
    expect(plan.status === 'DEGRADED' && plan.reasons).toEqual(['window.unknown']);
  });
});

describe('gcal.event: time zones and dates', () => {
  it('a secondary time zone beside the primary → DEGRADED time_zone.ambiguous, whichever the browser matches', () => {
    const dual = edited(
      htmlOf(WEEK),
      '<div class="tUR07l ObJo6" aria-hidden="true">GMT-04</div>',
      '<div aria-hidden="true"><div>GMT+02</div><div>GMT-04</div></div>',
    );
    for (const zone of ['Europe/Paris', 'America/New_York']) {
      expect(run(dual, WEEK, zone).plan).toEqual({
        status: 'DEGRADED',
        reasons: ['time_zone.ambiguous'],
        observations: [],
      });
    }
  });

  it('a hint written with U+2212 MINUS SIGN is read (and checked) like "GMT-04"', () => {
    const html = edited(htmlOf(WEEK), '>GMT-04<', '>GMT−04<');
    expect(run(html).plan.status).toBe('OK');
    expect(run(html, WEEK, 'Europe/Paris').plan).toMatchObject({ reasons: ['time_zone.mismatch'] });
  });

  it('a label whose start day is after every day its chips sit in → DEGRADED event.unreadable', () => {
    const html = edited(
      htmlOf(WEEK),
      'Investor call, Avery Founder, Accepted, Guests: morgan.patel@example.com, October 7',
      'Investor call, Avery Founder, Accepted, Guests: morgan.patel@example.com, October 9',
    );
    expect(run(html).plan).toEqual({ status: 'DEGRADED', reasons: ['event.unreadable'], observations: [] });
  });
});

describe('gcal.event: accounts', () => {
  it('a second account (/u/1/): its coverage and its snapshot name its own hash, never the first one', () => {
    const second = 'casey.second@example.net';
    const html = htmlOf(WEEK)
      .replaceAll('avery.founder@example.com)', `${second})`)
      .replaceAll('/u/0/', '/u/1/');
    const { plan, observer } = run(html);
    expect(plan.status === 'OK' && plan.coverage.map((c) => c.accountHash)).toEqual([accountHashOf(second)]);
    expect(plan.status === 'OK' && plan.snapshot !== undefined).toBe(true);
    // The service worker keys the range's stored snapshots by the account the snapshot message names.
    expect(observer.passAccount(WEEK.page.readAt)).toBe(accountHashOf(second));
    expect(plan.observations).toEqual([]);
  });

  it('a page with no account is compared with nothing: every event a first sighting, never a change', () => {
    const html = edited(htmlOf(WEEK), /aria-label="Google Account:[^"]*"/u, 'aria-label="Menu"');
    const { plan, observer } = run(html);
    expect(plan.observations).toHaveLength(WEEK.events.length);
    expect(new Set(plan.observations.map((o) => o.type))).toEqual(new Set(['calendar.created']));
    expect(plan.status === 'OK' && plan.coverage.map((c) => c.accountHash)).toEqual([undefined]);
    expect(plan).not.toHaveProperty('snapshot');
    expect(observer.passAccount(WEEK.page.readAt)).toBeNull();
  });
});
