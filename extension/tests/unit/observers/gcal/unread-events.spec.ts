/**
 * Every event the page shows is read or the pass is DEGRADED (real capture of 2026-10-06; Hard Rules 5, 6). Month
 * view draws an event as an element carrying its id around the button, not as the button: the reader once matched
 * none of them, while the month's windows vouched for every day, so a real event could grade NOT_FOUND. Now that
 * shape is a chip, and an id the page shows that no chip reads makes the pass DEGRADED `event.unreadable`.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { chipsOf } from '../../../../src/observers/gcal/page';
import { planPass } from '../../../../src/observers/plan';
import { ctxOf, docOf, fixture, observerFor } from './gcal-fixtures';

const WEEK = fixture('synthetic-gcal-week-two-calendars.html');

const chipElements = (doc: Document): Element[] =>
  Array.from(doc.querySelectorAll('[role="main"] [role="button"][data-eventid]'));

const statusOf = (doc: Document): string => {
  const plan = planPass({ observer: observerFor(WEEK), doc, ctx: ctxOf(WEEK), policy: DEFAULT_POLICY });
  return plan.status === 'DEGRADED' ? `DEGRADED ${plan.reasons.join()}` : plan.status;
};

describe('every event the page shows is read, or the pass is DEGRADED', () => {
  it('an event drawn as month view draws it (the id around its button) is a chip, read as before', () => {
    const doc = docOf(WEEK);
    const before = chipsOf(doc.querySelector('[role="main"]') ?? doc.body);
    for (const chip of chipElements(doc)) {
      const button = doc.createElement('div');
      button.setAttribute('role', 'button');
      button.append(...Array.from(chip.childNodes));
      chip.removeAttribute('role');
      chip.append(button);
    }
    expect(chipsOf(doc.querySelector('[role="main"]') ?? doc.body)).toEqual(before);
    expect(statusOf(doc)).toBe(statusOf(docOf(WEEK)));
  });

  it('an event shown in a shape no chip reads makes the pass DEGRADED event.unreadable, never OK without it', () => {
    const doc = docOf(WEEK);
    const [first] = chipElements(doc);
    if (first === undefined) throw new Error('no chip');
    first.setAttribute('role', 'none');
    expect(statusOf(doc)).toBe('DEGRADED event.unreadable');
  });
});
