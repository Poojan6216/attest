/**
 * The Calendar observer while the page is still drawing its range (sprint_2 2.7; src/observers/gcal/page.ts
 * `pageBusy`; Hard Rules 5, 6): a half-drawn week is never read as deletions. While `role="main"`, a grid in it, or
 * an ancestor of either is `aria-busy="true"`, or a progress bar is shown in `role="main"`, the pass is health OK
 * with no rows, no coverage and no snapshot (drawing is not a fault). Once drawn, the same page reads as usual. A page
 * that stays busy is DEGRADED `page.busy` once its run of busy passes has lasted BUSY_LIMIT_MS (SEC-10: never OK with
 * no coverage forever). And days that each hide events behind their own "N more" are a page read whole with nothing
 * seen whole: OK, no coverage, its snapshot still posted; a "more" control in no day is a layout the reader does not
 * know: DEGRADED `window.unknown`.
 *
 * What a page's snapshot implies is the diff's (src/observers/gcal/diff.ts), which the service worker runs on every
 * pass against the range's stored snapshot: the tests compare the drawn week before the edit with the page read here.
 */
import { describe, expect, it } from 'vitest';

import type { BusMessage } from '../../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { type IsoTs } from '../../../../src/core/schema';
import { runPass } from '../../../../src/observers/base';
import { diffSnapshots } from '../../../../src/observers/gcal/diff';
import { BUSY_GAP_MS, BUSY_LIMIT_MS } from '../../../../src/observers/gcal/health';
import type { GcalObserver } from '../../../../src/observers/gcal/observer';
import { planPass } from '../../../../src/observers/plan';
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

function plan(f: LabelledFixture, doc: Document) {
  return planPass({ observer: observerFor(f), doc, ctx: ctxOf(f), policy: DEFAULT_POLICY });
}

/** The change rows the snapshot of `doc` (read as `f`'s page) implies against the drawn week before the deletion. */
function changesAgainstEdit(f: LabelledFixture, doc: Document): string[] {
  const snapshot = observerFor(f).snapshot(doc, ctxOf(f));
  if (snapshot === null) throw new Error('no snapshot');
  return diffSnapshots(snapshotOfFixture(EDIT), snapshot).changes.map((row) => row.type);
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
    const changes = changesAgainstEdit(
      DELETE,
      halfDrawn(DELETE, () => undefined),
    );
    expect(changes.length).toBeGreaterThan(1);
    expect(new Set(changes)).toEqual(new Set(['calendar.deleted']));
  });

  it.each(BUSY)('%s: health OK, no rows, no coverage, no snapshot', (_, mark) => {
    const doc = halfDrawn(DELETE, mark);
    const observer = observerFor(DELETE);
    expect(observer.health(doc)).toEqual({ status: 'OK' });
    expect(observer.snapshot(doc, ctxOf(DELETE))).toBeNull();
    expect(plan(DELETE, doc)).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
  });

  it('a busy pass posts its health, OK, and nothing else, even with an account switcher still drawing', async () => {
    const doc = halfDrawn(DELETE, (d) => {
      main(d).setAttribute('aria-busy', 'true');
      d.querySelector('[aria-label^="Google Account:"]')?.setAttribute('aria-label', 'Google Account:');
    });
    const recording = recordingPost();
    const result = await runPass(observerFor(DELETE), {
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

/** `DELETE.page.readAt` plus `ms`, in New York time. */
function after(ms: number): IsoTs {
  const at = new Date(Date.parse(DELETE.page.readAt) + ms - 4 * 3_600_000);
  return `${at.toISOString().slice(0, 19)}-04:00` as IsoTs;
}

/** One pass of `observer` over `doc` at `DELETE.page.readAt` + `ms`: its status and reasons. */
function passAt(observer: GcalObserver, doc: Document, ms: number): string {
  const result = planPass({
    observer,
    doc,
    ctx: { ...ctxOf(DELETE), observedAt: after(ms) },
    policy: DEFAULT_POLICY,
  });
  return result.status === 'DEGRADED' ? `DEGRADED ${result.reasons.join()}` : result.status;
}

const busyPage = (): Document =>
  halfDrawn(DELETE, (doc) => {
    main(doc).setAttribute('aria-busy', 'true');
  });
const MINUTE = 60_000;

describe('a page that stays busy is DEGRADED page.busy (SEC-10, Hard Rule 6: never OK with no coverage forever)', () => {
  it('once a run of busy passes has lasted BUSY_LIMIT_MS, until a pass finds the page drawn', () => {
    expect(BUSY_LIMIT_MS).toBe(5 * MINUTE);
    const observer = observerFor(DELETE);
    const doc = busyPage();
    const run = [0, 1, 2, 3, 4, 5].map((minute) => passAt(observer, doc, minute * MINUTE));
    expect(run).toEqual(Array.from({ length: 6 }, () => 'OK_NO_COVERAGE'));
    // The run has lasted 5 minutes: the next busy pass, and every one after it, is DEGRADED.
    expect(passAt(observer, doc, 6 * MINUTE)).toBe('DEGRADED page.busy');
    expect(passAt(observer, doc, 7 * MINUTE)).toBe('DEGRADED page.busy');
    // A pass that finds the page drawn ends the run; a busy page after it starts a new one.
    expect(passAt(observer, docOf(DELETE), 8 * MINUTE)).toBe('OK');
    expect(passAt(observer, doc, 9 * MINUTE)).toBe('OK_NO_COVERAGE');
  });

  it('a gap longer than BUSY_GAP_MS between two busy passes starts a new run (the tab was hidden)', () => {
    const observer = observerFor(DELETE);
    const doc = busyPage();
    const step = BUSY_GAP_MS + 1_000;
    const spaced = [0, 1, 2, 3, 4, 5].map((i) => passAt(observer, doc, i * step));
    expect(spaced).toEqual(Array.from({ length: 6 }, () => 'OK_NO_COVERAGE'));
    // Passes BUSY_GAP_MS apart keep one run going.
    const kept = [0, 1, 2, 3].map((i) => passAt(observer, doc, 6 * step + i * BUSY_GAP_MS));
    expect(kept).toEqual(['OK_NO_COVERAGE', 'OK_NO_COVERAGE', 'OK_NO_COVERAGE', 'OK_NO_COVERAGE']);
    expect(passAt(observer, doc, 6 * step + 4 * BUSY_GAP_MS)).toBe('DEGRADED page.busy');
  });

  it('a run that already made the page DEGRADED still ends on a gap or a clock that went back', () => {
    const observer = observerFor(DELETE);
    const doc = busyPage();
    const run = [0, 1, 2, 3, 4, 5, 6].map((minute) => passAt(observer, doc, minute * MINUTE));
    expect(run.at(-1)).toBe('DEGRADED page.busy');
    // The tab sat hidden for an hour: its first busy pass after that starts a new run, never cries wolf.
    const back = 6 * MINUTE + BUSY_GAP_MS + 60 * MINUTE;
    expect(passAt(observer, doc, back)).toBe('OK_NO_COVERAGE');
    for (const minute of [1, 2, 3, 4, 5])
      expect(passAt(observer, doc, back + minute * MINUTE)).toBe('OK_NO_COVERAGE');
    expect(passAt(observer, doc, back + 6 * MINUTE)).toBe('DEGRADED page.busy');
    // So does a clock that went back while the page was DEGRADED.
    expect(passAt(observer, doc, 0)).toBe('OK_NO_COVERAGE');
  });

  it('a clock that went back starts a new run', () => {
    const observer = observerFor(DELETE);
    const doc = busyPage();
    for (const minute of [10, 11, 12, 13, 14])
      expect(passAt(observer, doc, minute * MINUTE)).toBe('OK_NO_COVERAGE');
    expect(passAt(observer, doc, 0)).toBe('OK_NO_COVERAGE');
    expect(passAt(observer, doc, MINUTE)).toBe('OK_NO_COVERAGE');
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
    const observer = observerFor(DELETE);
    const unmarked = docOf(DELETE);
    draw(unmarked);
    const health = observer.health(unmarked);
    expect(health.status === 'DEGRADED' ? health.reasons : []).toContain(reason);
    const busy = docOf(DELETE);
    draw(busy);
    mark(busy);
    expect(observer.health(busy)).toEqual({ status: 'OK' });
    expect(plan(DELETE, busy)).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
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
    expect(plan(DELETE, doc).status).toBe('OK');
    expect(changesAgainstEdit(DELETE, doc)).toEqual(['calendar.deleted']);
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
    const result = plan(EDIT, doc);
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
    const result = plan(EDIT, doc);
    expect(result).toMatchObject({ status: 'DEGRADED', reasons: ['window.unknown'] });
    expect(result).not.toHaveProperty('snapshot');
  });
});
