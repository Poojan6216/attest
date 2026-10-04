/**
 * The Calendar observer's health (sprint_2 2.5; agents/adapter_engineer.md rule 2; Hard Rules 5, 6): a fixture with
 * one landmark broken at a time reports DEGRADED with that reason code, and the pass then extracts nothing and
 * writes no coverage. The broken pages are the labelled fixtures with one string changed.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { createGcalObserver } from '../../../../src/observers/gcal/observer';
import { planPass } from '../../../../src/observers/plan';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { ctxOf, fixture, htmlOf, observerFor, parseDocument } from './gcal-fixtures';

const WEEK = fixture('synthetic-gcal-week-after-create.html');
const MONTH = fixture('synthetic-gcal-month-november.html');

function healthOf(html: string, timeZone = WEEK.page.timeZone) {
  return createGcalObserver({ offsetAt: zoneOffset(timeZone), previous: () => null }).health(
    parseDocument(html),
  );
}

function edited(base: string, from: string | RegExp, to: string): string {
  const html = base.replace(from, to);
  if (html === base) throw new Error(`the fixture has no ${String(from)}`);
  return html;
}

/** A minimal month-like page with `count` consecutive days from 1 Oct 2026 and no events. */
function daysPage(count: number): string {
  const first = ((2026 - 1970) << 9) | (10 << 5) | 1;
  const cells = Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 1 + i));
    const key = ((date.getUTCFullYear() - 1970) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    return `<div role="gridcell" data-datekey="${String(i === 0 ? first : key)}"></div>`;
  });
  return `<!doctype html><html><body><div role="complementary"><div role="list"><div role="checkbox" aria-checked="true" aria-label="Me"></div></div></div><div role="main"><div role="grid">${cells.join('')}</div></div></body></html>`;
}

describe('gcal.event health', () => {
  const week = htmlOf(WEEK);

  it.each([
    ['no role="main"', edited(week, /role="main"/u, 'role="region"'), 'selector.missing.main'],
    [
      'no grid in main',
      edited(week, '<div role="grid" aria-readonly="true"', '<div role="presentation"'),
      'selector.missing.grid',
    ],
    [
      'a day key that is not a date',
      edited(week, /data-datekey="28996"/gu, 'data-datekey="abc"'),
      'range.invalid',
    ],
    ['a missing day', edited(week, /data-datekey="28999"/gu, 'data-datekey="29003"'), 'range.invalid'],
    ['no calendar list', edited(week, /role="checkbox"/gu, 'role="none"'), 'selector.missing.calendar_list'],
    [
      'an unknown time shape',
      edited(week, '10am to 10:30am, Weekly sync', '10am – 10:30am, Weekly sync'),
      'event.unreadable',
    ],
    [
      "one event's chips that disagree",
      edited(
        week,
        'Late deploy window, Avery Founder, Accepted, Guests',
        'Late deploy window, Avery Founder, Declined, Guests',
      ),
      'event.unreadable',
    ],
    [
      'a chip with no label',
      edited(week, /<div class="L4fW Uj U9i">All day, Founder offsite[^<]*<\/div>/u, ''),
      'event.unreadable',
    ],
    [
      'a chip on a calendar the list says is off',
      edited(
        week,
        'aria-checked="true" aria-label="Avery Founder"',
        'aria-checked="false" aria-label="Avery Founder"',
      ),
      'event.calendar_hidden',
    ],
    ['a range longer than six weeks (year view)', daysPage(43), 'range.too_long'],
  ])('%s → DEGRADED %s', (_, html, reason) => {
    expect(healthOf(html)).toEqual({ status: 'DEGRADED', reasons: [reason] });
  });
});

describe('gcal.event health: ranges, zones and the pass', () => {
  const week = htmlOf(WEEK);

  it('a six-week range with no events is OK', () => {
    expect(healthOf(daysPage(42))).toEqual({ status: 'OK' });
  });

  it('a start a DST change repeats (1:30am on Sun 1 Nov, New York) → DEGRADED event.time_ambiguous', () => {
    const html = edited(
      htmlOf(MONTH),
      '12:30am to 12:55am, Red-eye arrives',
      '1:30am to 1:55am, Red-eye arrives',
    );
    expect(healthOf(html, MONTH.page.timeZone)).toEqual({
      status: 'DEGRADED',
      reasons: ['event.time_ambiguous'],
    });
  });

  it("the page's GMT-04 hint against another browser zone → DEGRADED time_zone.mismatch", () => {
    expect(healthOf(week, 'Europe/Paris')).toEqual({ status: 'DEGRADED', reasons: ['time_zone.mismatch'] });
    expect(healthOf(week, 'America/Toronto')).toEqual({ status: 'OK' });
  });

  it('a month view shows no zone hint: it is read in the browser zone', () => {
    expect(healthOf(htmlOf(MONTH), 'Europe/Paris')).toEqual({ status: 'OK' });
  });

  it('a DEGRADED page extracts nothing and writes no coverage', () => {
    const html = edited(week, /role="checkbox"/gu, 'role="none"');
    const plan = planPass({
      observer: observerFor(WEEK),
      doc: parseDocument(html),
      ctx: ctxOf(WEEK),
      policy: DEFAULT_POLICY,
    });
    expect(plan).toEqual({
      status: 'DEGRADED',
      reasons: ['selector.missing.calendar_list'],
      observations: [],
    });
  });

  it('extract() on a page health() would refuse throws, so the pass reports extract.threw and no rows', () => {
    const observer = createGcalObserver({ offsetAt: zoneOffset(WEEK.page.timeZone), previous: () => null });
    const ctx = { ...ctxOf(WEEK), offsetAt: zoneOffset('Europe/Paris') };
    const plan = planPass({ observer, doc: parseDocument(week), ctx, policy: DEFAULT_POLICY });
    expect(plan).toEqual({ status: 'DEGRADED', reasons: ['extract.threw'], observations: [] });
  });
});
