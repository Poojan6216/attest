/**
 * Edges of the capture tool's receipt-row and written-address rules that the first tests left open (QA third review
 * of sprint 2, 2026-10-07; tests/tools/capture-rows.ts, tests/tools/capture-url.ts; docs/adapters.md §6.2). Each case
 * is one a mutant of those rules got through. Every value here is made up for the test, in the shape a receipt uses.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { sanitizeHtml, type SeedSecret } from '../../tools/sanitize';

let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

const GMAIL = 'https://mail.google.com/mail/u/0/';
const CALENDAR = 'https://calendar.google.com/calendar/u/0/r/week';

function sanitized(html: string, pageUrl = GMAIL): string {
  const page = `<!doctype html><html><head><title>t</title></head><body><div role="main">${html}</div></body></html>`;
  return sanitizeHtml(page, { seed: 'rows-edges', seeds: SEEDS, pageUrl }).html;
}

describe('a card ending of 5 digits (capture-rows.ts BARE_ENDING: "4 or 5 digits")', () => {
  it('is faked in a row that names a payment method, in its own shape', () => {
    const out = sanitized('<table><tr><td>Payment method</td><td>31005</td></tr></table>');
    expect(out).not.toContain('31005');
    expect(out).toMatch(/<td>Payment method<\/td><td>\d{5}<\/td>/u);
  });
});

describe('an order number in a labelled row (capture-rows.ts rowIds, MIN_ID_LENGTH)', () => {
  it('is faked in any value cell of the row, not only the first with text', () => {
    const out = sanitized('<table><tr><td>Order #</td><td>Placed</td><td>A1234</td></tr></table>');
    expect(out).not.toContain('A1234');
    expect(out).toMatch(/<td>Placed<\/td><td>[A-Z]\d{4}<\/td>/u);
  });

  it('is faked from 4 characters on; a shorter word is no order number', () => {
    const out = sanitized(
      '<table><tr><td>Order #</td><td>Q7X9</td></tr><tr><td>Receipt #</td><td>Z12</td></tr></table>',
    );
    expect(out).not.toContain('Q7X9');
    expect(out).toContain('<td>Z12</td>');
  });
});

describe('a written address with no scheme (capture-url.ts TEXT_URL)', () => {
  it('a dotted name inside a path or after a slash is no host: the text is kept', () => {
    const out = sanitized('<p>files/report.final.pdf/v2 and ./notes.draft.md/x</p>', CALENDAR);
    expect(out).toContain('<p>files/report.final.pdf/v2 and ./notes.draft.md/x</p>');
  });
});

describe('a Meet code (capture-rows.ts MEET_CODE) is three, four and three letters standing alone', () => {
  it('a longer hyphenated word in a text that names Meet is kept', () => {
    const out = sanitized('<p>Google Meet tips: a one-time-use-only room, and pre-made-plan-b</p>');
    expect(out).toContain('one-time-use-only');
    expect(out).toContain('pre-made-plan-b');
  });
});
