/**
 * One read of a Calendar page per pass (src/observers/gcal/pass-read.ts; TECH-2). A pass asks the observer for its
 * health, its rows, its windows, whether every calendar is shown, its snapshot and its account, in one synchronous
 * run; all of them answer from one read of the page, and the next pass reads the page afresh. Each case counts how
 * often the page is queried for its main landmark, against what one read costs.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { createGcalObserver, GCAL_ATTRIBUTES } from '../../../../src/observers/gcal/observer';
import { readPass } from '../../../../src/observers/gcal/pass-read';
import { planPass } from '../../../../src/observers/plan';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { ctxOf, docOf, fixture } from './gcal-fixtures';

const MAIN = '[role="main"]';

/** How often `run` queries `doc` for its main landmark. */
function mainQueries(doc: Document, run: () => void): number {
  const queries = vi.spyOn(doc, 'querySelectorAll');
  run();
  const count = queries.mock.calls.filter(([selector]) => selector === MAIN).length;
  queries.mockRestore();
  return count;
}

/** The observer and the pass context as production pairs them: one offset function for both. */
function setup(f: LabelledFixture) {
  const offsetAt = zoneOffset(f.page.timeZone);
  const observer = createGcalObserver({ offsetAt });
  return { observer, offsetAt, ctx: { ...ctxOf(f), offsetAt } };
}

describe('a Calendar pass reads its page once (TECH-2)', () => {
  it.each([
    'synthetic-gcal-week-after-create.html',
    'synthetic-gcal-month-november.html',
    'synthetic-gcal-week-two-calendars.html',
  ])('%s: health, rows, windows, calendars, snapshot and account share one read', (file) => {
    const f = fixture(file);
    const { observer, offsetAt, ctx } = setup(f);
    const doc = docOf(f);
    const one = mainQueries(doc, () => readPass(doc, offsetAt));
    expect(one).toBeGreaterThan(0);
    const pass = mainQueries(doc, () => {
      const plan = planPass({ observer, doc, ctx, policy: DEFAULT_POLICY });
      expect(plan.status).toBe('OK');
      expect(plan).toHaveProperty('snapshot');
    });
    expect(pass).toBe(one);
  });

  it('the next pass, after the run yields, reads the page again', async () => {
    const f = fixture('synthetic-gcal-week-before.html');
    const { observer, offsetAt, ctx } = setup(f);
    const doc = docOf(f);
    const one = mainQueries(doc, () => readPass(doc, offsetAt));
    const first = mainQueries(doc, () => planPass({ observer, doc, ctx, policy: DEFAULT_POLICY }));
    await Promise.resolve();
    const second = mainQueries(doc, () => planPass({ observer, doc, ctx, policy: DEFAULT_POLICY }));
    expect([first, second]).toEqual([one, one]);
  });

  it('a pass whose offset function is not the observer’s reads with each, so extract still fails loud', () => {
    const f = fixture('synthetic-gcal-week-before.html');
    const observer = createGcalObserver({ offsetAt: zoneOffset(f.page.timeZone) });
    const doc = docOf(f);
    const paris = { ...ctxOf(f), offsetAt: zoneOffset('Europe/Paris') };
    expect(observer.health(doc)).toEqual({ status: 'OK' });
    expect(() => observer.extract(doc, paris)).toThrow('gcal: unreadable_page');
  });
});

describe('the attributes a read depends on (TECH-2: the watcher starts a pass on these only)', () => {
  const f = fixture('synthetic-gcal-week-two-calendars.html');

  /** The snapshot and windows one pass reads from `doc`. */
  function readOf(doc: Document): string {
    const { observer, ctx } = setup(f);
    return JSON.stringify([
      observer.snapshot(doc, ctx),
      observer.visibleWindows(doc, ctx),
      observer.health(doc),
    ]);
  }

  it('names every attribute the selectors match on and the reader reads', () => {
    expect(GCAL_ATTRIBUTES).toEqual([
      'aria-busy',
      'aria-checked',
      'aria-hidden',
      'aria-label',
      'data-datekey',
      'data-eventid',
      'role',
    ]);
    expect(createGcalObserver({ offsetAt: zoneOffset(f.page.timeZone) }).attributes).toBe(GCAL_ATTRIBUTES);
  });

  it('an attribute it does not name never changes what a pass reads; one it names can', () => {
    const drawn = readOf(docOf(f));
    const hovered = docOf(f);
    for (const el of Array.from(hovered.querySelectorAll('*'))) {
      el.setAttribute('aria-expanded', 'true');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-tooltip', 'Dinner with Ottoline');
      el.setAttribute('title', 'Hovered');
    }
    expect(readOf(hovered)).toBe(drawn);
    const switched = docOf(f);
    for (const box of Array.from(switched.querySelectorAll('[role="checkbox"][aria-checked="true"]')))
      box.setAttribute('aria-checked', 'false');
    expect(readOf(switched)).not.toBe(drawn);
  });
});
