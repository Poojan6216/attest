/**
 * Shapes the real receipt captures of 2026-10-07 showed and the hand-built pages had not (sprint_2 2.1, 2.8):
 *  - Stripe wraps each total label in a table of its own beside its amount, so the label's row holds another row and
 *    read as layout: a real receipt was DEGRADED receipt.amount_missing. A row that holds other rows is now one line
 *    when exactly two of its cells hold text (src/observers/gmail/receipts/message.ts `rowCells`).
 *  - Uber sends a charge summary under the trip's subject ("This is not a payment receipt") hours before the trip
 *    receipt, and both were purchases of one trip (the live smoke recorded both). The summary is refused by its text
 *    (selectors.json `platforms.uber.kinds[0].refuseText`, gmail.receipt 1.4.0).
 */
import { describe, expect, it } from 'vitest';

import { receiptVerdicts } from '../../../../src/observers/gmail/receipts';
import { onPage, paragraphs } from './message-page';

/** One of Stripe's total rows as captured: spacer cells, the label in a table of its own, the amount. */
const stripeRow = (label: string, value: string): string =>
  `<tr><td width="20"></td><td><table><tbody><tr><td><span>${label}</span></td></tr></tbody></table></td>` +
  `<td width="8"></td><td align="right"><span>${value}</span></td><td width="20"></td></tr>`;

const stripeVerdict = (rows: string) => {
  const [verdict] = onPage(
    {
      subject: 'Your receipt from Acme Inc. #1234-5678',
      messages: [
        {
          from: 'invoice+statements@stripe.com',
          name: 'Acme Inc.',
          body: `<table><tbody>${rows}</tbody></table>`,
        },
      ],
    },
    (doc) => receiptVerdicts(doc),
  );
  if (verdict === undefined) throw new Error('no message');
  return verdict.verdict;
};

describe('a total label in a table of its own beside its amount (Stripe, real capture of 2026-10-07)', () => {
  it('reads the row whose two cells with text are the label and the amount', () => {
    expect(stripeVerdict(stripeRow('Total', '$12.34') + stripeRow('Amount paid', '$12.34'))).toMatchObject({
      kind: 'receipt',
      facts: { parser: 'stripe', merchant: 'Acme Inc.', money: { minor: 1234, currency: 'USD' } },
    });
  });

  it('such rows are lines like any other: two that disagree are ambiguous, and nothing is guessed', () => {
    expect(stripeVerdict(stripeRow('Total', '$12.34') + stripeRow('Total', '$12.00'))).toEqual({
      kind: 'unreadable',
      reason: 'receipt.amount_ambiguous',
    });
  });
});

describe("Uber's charge summary is no receipt (live smoke, 2026-10-07)", () => {
  it('the summary is refused by its text; the trip receipt of the same thread is read', () => {
    const verdicts = onPage(
      {
        subject: 'Your Saturday morning trip with Uber',
        messages: [
          {
            from: 'noreply@uber.com',
            name: 'Uber Receipts',
            key: '1a10271f6bffb89a',
            body: paragraphs('This is your charge summary', 'Total $23.45', 'This is not a payment receipt.'),
          },
          {
            from: 'noreply@uber.com',
            name: 'Uber Receipts',
            key: '1a104b0e72af6ba0',
            body: paragraphs('Thanks for riding', 'Total $23.45'),
          },
        ],
      },
      (doc) => receiptVerdicts(doc),
    );
    expect(verdicts.map((v) => [v.key, v.verdict.kind])).toEqual([
      ['1a10271f6bffb89a', 'none'],
      ['1a104b0e72af6ba0', 'receipt'],
    ]);
  });
});
