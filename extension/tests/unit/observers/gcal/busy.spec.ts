/**
 * The Calendar observer while the page is still drawing its range (sprint_2 2.7; src/observers/gcal/page.ts
 * `pageBusy`; Hard Rules 5, 6): a half-drawn week is never read as deletions. While `role="main"`, a grid in it, or
 * an ancestor of either is `aria-busy="true"`, or a progress bar is shown in `role="main"`, the pass is health OK
 * with no rows, no coverage and no snapshot (never DEGRADED: drawing is not a fault). Once drawn, the same page reads
 * as usual. And days that each hide events behind their own "N more" are a page read whole with nothing seen whole:
 * OK, no coverage, its snapshot still posted; a "more" control in no day is a layout the reader does not know:
 * DEGRADED `window.unknown`.
 */
import { describe, expect, it } from 'vitest';

import type { BusMessage } from '../../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { runPass } from '../../../../src/observers/base';
import { planPass } from '../../../../src/observers/plan';
import type { CalendarSnapshot } from '../../../../src/observers/gcal/snapshot';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { recordingPost } from '../helpers';
import { ctxOf, docOf, fixture, observerFor, snapshotOfFixture } from './gcal-fixtures';

const EDIT = fixture('synthetic-gcal-week-after-edit.html');
const DELETE = fixture('synthetic-gcal-week-after-delete.html');

/** `f`'s page with every event chip removed (the grid not drawn yet), then `mark` applied. */
function halfDrawn(f: LabelledFixture, mark: (doc: Document) => void): Document {
  const doc = docOf(f);
  for (const chip of Array.from(doc.querySelectorAll('[data-eventid]'))) chip.remove();
  mark(doc);
  return doc;
}

function main(doc: Document): Element {
  const found = doc.querySelector('[role="main"]');
  if (found === null) throw new Error('no main');
  return found;
}

function weekGrid(doc: Document): Element {
  const found = main(doc).querySelector('[role="grid"]');
  if (found === null) throw new Error('no grid');
  return found;
}

function progressIn(parent: Element, hidden = false): void {
  const bar = parent.ownerDocument.createElement('div');
  bar.setAttribute('role', 'progressbar');
  if (hidden) bar.setAttribute('hidden', '');
  parent.prepend(bar);
}

function plan(f: LabelledFixture, doc: Document, previous: CalendarSnapshot | null) {
  return planPass({ observer: observerFor(f, previous), doc, ctx: ctxOf(f), policy: DEFAULT_POLICY });
}

const BUSY: readonly [string, (doc: Document) => void][] = [
  [
    'main is aria-busy',
    (doc) => {
      main(doc).setAttribute('aria-busy', 'true');
    },
  ],
  [
    'the week grid is aria-busy',
    (doc) => {
      weekGrid(doc).setAttribute('aria-busy', 'true');
    },
  ],
  [
    'an ancestor of main is aria-busy',
    (doc) => {
      doc.body.setAttribute('aria-busy', 'true');
    },
  ],
  [
    'a progress bar is shown in main',
    (doc) => {
      progressIn(main(doc));
    },
  ],
];

describe('a page still drawing is not read (Hard Rule 5: a half-drawn week is never deletions)', () => {
  it('without the busy mark, the same half-drawn page would read every event as deleted', () => {
    const result = plan(
      DELETE,
      halfDrawn(DELETE, () => undefined),
      snapshotOfFixture(EDIT),
    );
    expect(result.observations.length).toBeGreaterThan(1);
    expect(new Set(result.observations.map((o) => o.type))).toEqual(new Set(['calendar.deleted']));
  });

  it.each(BUSY)('%s: health OK, no rows, no coverage, no snapshot', (_, mark) => {
    const doc = halfDrawn(DELETE, mark);
    const observer = observerFor(DELETE, snapshotOfFixture(EDIT));
    expect(observer.health(doc)).toEqual({ status: 'OK' });
    expect(observer.snapshot(doc, ctxOf(DELETE))).toBeNull();
    expect(plan(DELETE, doc, snapshotOfFixture(EDIT))).toEqual({
      status: 'OK_NO_COVERAGE',
      observations: [],
    });
  });

  it('a busy pass posts its health, OK, and nothing else, even with an account switcher still drawing', async () => {
    const doc = halfDrawn(DELETE, (d) => {
      main(d).setAttribute('aria-busy', 'true');
      d.querySelector('[aria-label^="Google Account:"]')?.setAttribute('aria-label', 'Google Account:');
    });
    const recording = recordingPost();
    const result = await runPass(observerFor(DELETE, snapshotOfFixture(EDIT)), {
      doc,
      post: recording.post,
      now: () => DELETE.page.readAt,
      offsetAt: zoneOffset(DELETE.page.timeZone),
      policy: DEFAULT_POLICY,
      userActive: () => false,
    });
    expect(result).toEqual({ status: 'OK', reasons: [], posted: ['adapter.health'], complete: true });
    expect(recording.messages.map((m: BusMessage) => m.type)).toEqual(['adapter.health']);
  });
});

describe('a busy page is never DEGRADED for what it has not drawn yet (Hard Rule 6)', () => {
  it.each<[string, (doc: Document) => void, (doc: Document) => void, string]>([
    [
      'a main with no grid drawn yet',
      (doc) => {
        for (const grid of Array.from(main(doc).querySelectorAll('[role="grid"]'))) grid.remove();
      },
      (doc) => {
        main(doc).setAttribute('aria-busy', 'true');
      },
      'selector.missing.grid',
    ],
    [
      'a chip whose label is not drawn yet',
      (doc) => {
        const chip = main(doc).querySelector('[data-eventid]');
        if (chip === null) throw new Error('no chip');
        chip.removeAttribute('aria-label');
        chip.textContent = '';
      },
      (doc) => {
        weekGrid(doc).setAttribute('aria-busy', 'true');
      },
      'event.unreadable',
    ],
  ])('%s: DEGRADED (%s) unmarked, but health OK and nothing read while busy', (_, draw, mark, reason) => {
    const observer = observerFor(DELETE, snapshotOfFixture(EDIT));
    const unmarked = docOf(DELETE);
    draw(unmarked);
    const health = observer.health(unmarked);
    expect(health.status === 'DEGRADED' ? health.reasons : []).toContain(reason);
    const busy = docOf(DELETE);
    draw(busy);
    mark(busy);
    expect(observer.health(busy)).toEqual({ status: 'OK' });
    expect(plan(DELETE, busy, snapshotOfFixture(EDIT))).toEqual({
      status: 'OK_NO_COVERAGE',
      observations: [],
    });
  });
});

describe('a page that only looks busy is read as usual', () => {
  it.each<[string, (doc: Document) => void]>([
    [
      'aria-busy="false"',
      (doc) => {
        main(doc).setAttribute('aria-busy', 'false');
      },
    ],
    [
      'a hidden progress bar in main',
      (doc) => {
        progressIn(main(doc), true);
      },
    ],
    [
      'a progress bar outside main (the side panel)',
      (doc) => {
        const panel = doc.querySelector('[role="complementary"]');
        if (panel === null) throw new Error('no side panel');
        progressIn(panel);
      },
    ],
  ])('%s is not busy: the drawn page reads as usual (one calendar.deleted)', (_, mark) => {
    const doc = docOf(DELETE);
    mark(doc);
    const result = plan(DELETE, doc, snapshotOfFixture(EDIT));
    expect(result.status).toBe('OK');
    expect(result.observations.map((o) => o.type)).toEqual(['calendar.deleted']);
  });
});

/** Puts a "2 more" button in the day cell of each `datekey`. */
function hideEventsOn(doc: Document, datekeys: readonly number[]): void {
  for (const key of datekeys) {
    const cell = doc.querySelector(`[role="gridcell"][data-datekey="${String(key)}"]`);
    if (cell === null) throw new Error(`no day ${String(key)}`);
    const more = doc.createElement('div');
    more.setAttribute('role', 'button');
    more.textContent = '2 more';
    cell.prepend(more);
  }
}

describe('days that hide events, and a "more" control in no day', () => {
  const WEEK_KEYS = [28996, 28997, 28998, 28999, 29000, 29001, 29002];

  it('every day hiding events behind its own "N more": OK, no coverage, the snapshot still kept', () => {
    const doc = docOf(EDIT);
    hideEventsOn(doc, WEEK_KEYS);
    const result = plan(EDIT, doc, null);
    expect(result.status).toBe('OK_NO_COVERAGE');
    const snapshot = observerFor(EDIT).snapshot(doc, ctxOf(EDIT));
    expect(snapshot?.days.every((day) => !day.complete)).toBe(true);
    expect(result).toMatchObject({ snapshot });
  });

  it('a "more" control in no day: the windows are unknown, DEGRADED window.unknown, no snapshot', () => {
    const doc = docOf(EDIT);
    const stray = doc.createElement('div');
    stray.setAttribute('role', 'button');
    stray.textContent = '3 more';
    main(doc).prepend(stray);
    const result = plan(EDIT, doc, null);
    expect(result).toMatchObject({ status: 'DEGRADED', reasons: ['window.unknown'] });
    expect(result).not.toHaveProperty('snapshot');
  });
});
