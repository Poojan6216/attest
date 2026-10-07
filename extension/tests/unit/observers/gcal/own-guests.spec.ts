/**
 * The account among an event's guests (security re-review, SEC-R7 and SEC-R8; Hard Rule 2): the account's own mailbox
 * is left out of the guests in any spelling Gmail delivers to it (any case, a `+tag`), and a page that names no
 * account stores no guest at all, since the account could be any of them.
 */
import { describe, expect, it } from 'vitest';

import { readCalendar } from '../../../../src/observers/gcal/read';
import { accountlessHtmlOf, ctxOf, docOf, fixture, htmlOf, parseDocument } from './gcal-fixtures';

const WEEK = fixture('synthetic-gcal-week-before.html');
const GUEST = 'alex.rivera@example.com';

const guestsOf = (doc: Document): string[] => {
  const read = readCalendar(doc, ctxOf(WEEK).offsetAt);
  if (!read.ok) throw new Error(`unreadable: ${read.reasons.join()}`);
  return read.facts.events.flatMap((event) => event.guests);
};

describe('the account is never a guest (SEC-R7, SEC-R8)', () => {
  it('the fixture lists a guest, so these checks can fail', () => {
    expect(guestsOf(docOf(WEEK))).toContain(GUEST);
  });

  it('the account written with a +tag and in another case is the account: left out', () => {
    const tagged = parseDocument(htmlOf(WEEK).replaceAll(GUEST, `Avery.Founder+cal@Example.com`));
    expect(guestsOf(tagged).map((guest) => guest.toLowerCase())).not.toContain(
      'avery.founder+cal@example.com',
    );
  });

  it('a page that names no account stores no guest', () => {
    expect(guestsOf(parseDocument(accountlessHtmlOf(WEEK)))).toEqual([]);
  });
});
