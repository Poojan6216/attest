/**
 * Uber's charge summary is refused by its text wherever a body line holds it (QA third review of sprint 2,
 * 2026-10-07; src/observers/gmail/receipts/parser.ts `refused`, selectors.json `platforms.uber.kinds[0].refuseText`,
 * gmail.receipt 1.4.0). A table row is one body line of all its cells, so the sentence beside a label or an icon's
 * caption still refuses the message: reading only a row's first cell let the summary through as a second purchase of
 * the same trip (a mutant that read `cells[0]` passed every earlier test). Every value is made up.
 */
import { describe, expect, it } from 'vitest';

import { receiptVerdicts } from '../../../../src/observers/gmail/receipts';
import { onPage, paragraphs } from './message-page';

const SUBJECT = 'Your Saturday morning trip with Uber';

const verdictKinds = (summaryBody: string) =>
  onPage(
    {
      subject: SUBJECT,
      messages: [
        { from: 'noreply@uber.com', name: 'Uber Receipts', key: '1a1000000000aaa1', body: summaryBody },
        {
          from: 'noreply@uber.com',
          name: 'Uber Receipts',
          key: '1a1000000000bbb2',
          body: paragraphs('Thanks for riding', 'Total $23.45'),
        },
      ],
    },
    (doc) => receiptVerdicts(doc).map((v) => [v.key, v.verdict.kind]),
  );

describe("Uber's charge summary, its sentence in a table row (gmail.receipt 1.4.0)", () => {
  it('the sentence in the second cell of a row: the summary is refused, the trip receipt read', () => {
    const body =
      '<table><tr><td>Total</td><td>$23.45</td></tr>' +
      '<tr><td>Note</td><td>This is not a payment receipt.</td></tr></table>';
    expect(verdictKinds(body)).toEqual([
      ['1a1000000000aaa1', 'none'],
      ['1a1000000000bbb2', 'receipt'],
    ]);
  });

  it('the sentence split over two cells of a row is one line: still refused', () => {
    const body =
      '<table><tr><td>Total</td><td>$23.45</td></tr>' +
      '<tr><td>This is not a</td><td>payment receipt</td></tr></table>';
    expect(verdictKinds(body)).toEqual([
      ['1a1000000000aaa1', 'none'],
      ['1a1000000000bbb2', 'receipt'],
    ]);
  });

  it('the same row layout without the sentence is read: the refusal is the text, never the layout', () => {
    const body =
      '<table><tr><td>Total</td><td>$12.00</td></tr><tr><td>Note</td><td>Thanks for riding.</td></tr></table>';
    expect(verdictKinds(body)).toEqual([
      ['1a1000000000aaa1', 'receipt'],
      ['1a1000000000bbb2', 'receipt'],
    ]);
  });
});
