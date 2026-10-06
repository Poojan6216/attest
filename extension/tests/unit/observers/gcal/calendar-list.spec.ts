/**
 * The side panel's calendar list as real Google Calendar draws it (capture of 2026-10-06): native checkboxes, each
 * labelled with its calendar, whose ticked state changes as a property only, and lists that are drawn empty and fill
 * in seconds after the grid. The list is read the same as the `role="checkbox"` one; a box the page unticked is off;
 * empty lists mean the page is still drawing (OK, nothing read), never a missing list (Hard Rules 5, 6).
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { calendarsOf } from '../../../../src/observers/gcal/page';
import { planPass } from '../../../../src/observers/plan';
import { ctxOf, docOf, fixture, observerFor } from './gcal-fixtures';

const WEEK = fixture('synthetic-gcal-week-two-calendars.html');

/** Redraws the side panel's `role="checkbox"` calendars as native checkboxes, ticked as they were. */
function nativeBoxes(doc: Document): Document {
  for (const box of Array.from(doc.querySelectorAll('[role="complementary"] [role="checkbox"]'))) {
    const input = doc.createElement('input');
    input.setAttribute('type', 'checkbox');
    input.setAttribute('aria-label', box.getAttribute('aria-label') ?? '');
    if (box.getAttribute('aria-checked') === 'true') input.setAttribute('checked', '');
    box.replaceWith(input);
  }
  return doc;
}

const statusOf = (doc: Document): string => {
  const plan = planPass({ observer: observerFor(WEEK), doc, ctx: ctxOf(WEEK), policy: DEFAULT_POLICY });
  return plan.status === 'DEGRADED' ? `DEGRADED ${plan.reasons.join()}` : plan.status;
};

describe('the calendar list drawn as native checkboxes (real capture, 2026-10-06)', () => {
  it('reads the same calendars, ticked the same, as the role="checkbox" list', () => {
    const drawn = calendarsOf(docOf(WEEK));
    expect(drawn?.length).toBeGreaterThan(1);
    expect(calendarsOf(nativeBoxes(docOf(WEEK)))).toEqual(drawn);
    expect(statusOf(nativeBoxes(docOf(WEEK)))).toBe(statusOf(docOf(WEEK)));
  });

  it('a calendar the page unticked (the property only; the markup still says checked) is off', () => {
    const doc = nativeBoxes(docOf(WEEK));
    const [first] = Array.from(doc.querySelectorAll('[role="complementary"] input[type="checkbox"]'));
    if (first === undefined) throw new Error('no calendar box');
    Reflect.set(first, 'checked', false);
    expect(first.hasAttribute('checked')).toBe(true);
    expect(calendarsOf(doc)?.[0]?.shown).toBe(false);
  });

  it('lists drawn but still empty: the page is still drawing (OK, nothing read), never DEGRADED', () => {
    const doc = nativeBoxes(docOf(WEEK));
    for (const list of Array.from(doc.querySelectorAll('[role="complementary"] [role="list"]')))
      list.replaceChildren();
    const empty = planPass({ observer: observerFor(WEEK), doc, ctx: ctxOf(WEEK), policy: DEFAULT_POLICY });
    expect(empty.status).toBe('OK_NO_COVERAGE');
    expect(empty.observations).toEqual([]);
    expect('snapshot' in empty).toBe(false);
  });

  it('a list whose items hold no box this reader knows is a markup change: DEGRADED, as before', () => {
    const doc = nativeBoxes(docOf(WEEK));
    for (const box of Array.from(doc.querySelectorAll('[role="complementary"] input[type="checkbox"]')))
      box.setAttribute('type', 'button');
    expect(statusOf(doc)).toBe('DEGRADED selector.missing.calendar_list');
  });
});
