/**
 * The receipt observer on the shapes real mail and the real Gmail page take (sprint_2 2.3; 2.3 verification): the
 * synthetic fixtures write every total as a bare `<td>` pair, but a real receipt is an email template. These pin
 * what the verifier found missing:
 *
 *  - a total row whose cells wrap their text (`<td><p>Total</p></td>`, Shopify's template), sit between spacer
 *    cells, or break a cell with `<br>`, is still one label and one amount (a false DEGRADED and a lost receipt
 *    otherwise, Hard Rules 5, 6); a style sheet or a comment in a body is never mail text;
 *  - each message is classified by its own conversation's subject: Gmail can keep an earlier conversation's view in
 *    the page, and an unpaid invoice must never be read under a stale receipt's subject (a false purchase);
 *  - a list view whose address names a long label or search is a list, not an opened thread (no false DEGRADED);
 *  - a registry sender's other mail stays unparsed (Amazon delay, update and payment notices), and a domain that
 *    only ends like a registry domain is not one.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs, type Observation } from '../../../../src/core/schema';
import { planPass } from '../../../../src/observers/plan';
import { receiptObserver, receiptVerdicts } from '../../../../src/observers/gmail/receipts';
import { messagePage, onPage, rows, THREAD_URL } from './message-page';
import { withPage } from './receipt-fixtures';

const ctx = { observedAt: IsoTs.parse('2026-10-03T10:30:00-04:00'), offsetAt: () => -240 };
const UBER = 'Your Thursday evening trip with Uber';

function verdictsOf(subject: string, from: string, body: string, name = 'Sender') {
  return onPage({ subject, messages: [{ from, name, body }] }, (doc) => receiptVerdicts(doc));
}

/** The minor units the message's parser read, null when it read no receipt. */
function minorOf(subject: string, from: string, body: string, name?: string): number | null {
  const [first] = verdictsOf(subject, from, body, name);
  return first?.verdict.kind === 'receipt' ? (first.verdict.facts.money?.minor ?? null) : null;
}

/** [case, subject, sender, body, minor units]: total rows as real templates write them. */
const TEMPLATE_ROWS: readonly (readonly [string, string, string, string, number])[] = [
  [
    "Shopify's template: the label in a <p>, the amount in a <strong>",
    'Order #1047 confirmed',
    'store+1@t.shopifyemail.com',
    '<table><tr><td><p><span>Total</span></p></td><td><strong>$52.45 USD</strong></td></tr></table>',
    5245,
  ],
  [
    'both cells wrapped in <div>',
    UBER,
    'noreply@uber.com',
    '<table><tr><td><div>Total</div></td><td><div>$23.84</div></td></tr></table>',
    2384,
  ],
  [
    'spacer cells around the pair',
    UBER,
    'noreply@uber.com',
    '<table><tr><td width="20"></td><td>Total</td><td>$23.84</td><td width="20"></td></tr></table>',
    2384,
  ],
  [
    'a &nbsp; spacer before the label',
    UBER,
    'noreply@uber.com',
    '<table><tr><td>&nbsp;</td><td>Total</td><td>$23.84</td></tr></table>',
    2384,
  ],
  [
    'a header cell for the label',
    UBER,
    'noreply@uber.com',
    '<table><tr><th>Total</th><td>$23.84</td></tr></table>',
    2384,
  ],
  [
    'a <br> inside an inline wrapper',
    'Your receipt',
    'hello@corner-shop.example',
    '<p><span>Subtotal $10.00<br><b>Total</b> $11.50</span></p>',
    1150,
  ],
  [
    'a cell that breaks the amount from its currency',
    'Your receipt',
    'hello@corner-shop.example',
    '<table><tr><td>Total</td><td>$49.00<br>USD</td></tr></table>',
    4900,
  ],
  [
    'a two-column layout row whose second column holds the total line',
    UBER,
    'noreply@uber.com',
    '<table><tr><td><p>Thanks for riding</p></td><td><p>Total: $23.84</p></td></tr></table>',
    2384,
  ],
  [
    'a style sheet in the body is not mail text',
    UBER,
    'noreply@uber.com',
    '<div><style>.k { color: red } /* Total: $1.00 */</style>Total: $23.84</div>',
    2384,
  ],
  [
    'a comment in the body is not mail text',
    UBER,
    'noreply@uber.com',
    '<p><!-- Total: $1.00 -->Total: $23.84</p>',
    2384,
  ],
  [
    'a label glued to its amount by inline spans (spaced by CSS)',
    UBER,
    'noreply@uber.com',
    '<div><span>Total</span><span>$23.84</span></div>',
    2384,
  ],
];

describe('total rows as email templates write them', () => {
  it.each(TEMPLATE_ROWS)('%s', (_case, subject, from, body, minor) => {
    expect(minorOf(subject, from, body, 'Larkspur Tea Co.')).toBe(minor);
  });

  it.each(['Totally $23.84', 'Totals: $23.84', 'Total savings $23.84'])(
    'a line that only starts with the label is no total line: "%s"',
    (line) => {
      expect(verdictsOf(UBER, 'noreply@uber.com', `<p>${line}</p>`).map((v) => v.verdict)).toEqual([
        { kind: 'unreadable', reason: 'receipt.amount_missing' },
      ]);
    },
  );

  it('two totals that disagree are still ambiguous when one sits in a wrapped row', () => {
    const body =
      '<table><tr><td><p>Total</p></td><td><p>$23.84</p></td></tr></table><table><tr><td>Total</td><td>$9.00</td></tr></table>';
    expect(verdictsOf(UBER, 'noreply@uber.com', body).map((v) => v.verdict)).toEqual([
      { kind: 'unreadable', reason: 'receipt.amount_ambiguous' },
    ]);
  });
});

/** An opened-thread page whose main landmark holds two conversation views (`wrapped`: each in its own container). */
function twoViews(wrapped: boolean): string {
  const stale = messagePage({
    subject: 'Your receipt from Acme #1849-2210',
    messages: [
      {
        from: 'receipts@stripe.com',
        name: 'Acme',
        body: rows([['Amount paid', '$49.00']]),
        key: '1a0000000000000a',
      },
    ],
  });
  const open = messagePage({
    subject: 'Your invoice from Beta #77',
    messages: [
      {
        from: 'invoice@stripe.com',
        name: 'Beta',
        body: rows([['Total', '$500.00']]),
        key: '1a0000000000000b',
      },
    ],
  });
  const inner = (html: string): string =>
    html.slice(
      html.indexOf('role="main">') + 'role="main">'.length,
      html.lastIndexOf('</div></div></body>') + 6,
    );
  const views = wrapped
    ? `<div hidden>${inner(stale)}</div><div>${inner(open)}</div>`
    : `${inner(stale)}${inner(open)}`;
  return stale.replace(inner(stale), views);
}

describe('each message is read under its own conversation subject (Hard Rule 5)', () => {
  it.each([
    ['in their own containers', true],
    ['as siblings in the main landmark', false],
  ])('a stale receipt view beside an open unpaid invoice, %s: only the receipt is one', (_case, wrapped) => {
    const result = withPage(twoViews(wrapped), THREAD_URL, (doc) => ({
      verdicts: receiptVerdicts(doc).map((v) => [v.key, v.verdict.kind]),
      plan: planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
    }));
    expect(result.verdicts).toEqual([
      ['1a0000000000000a', 'receipt'],
      ['1a0000000000000b', 'none'],
    ]);
    const observations: readonly Observation[] = result.plan.observations;
    expect(observations.map((o) => [o.merchant, o.amountCents, o.subjectHint])).toEqual([
      ['Acme', 4900, 'Your receipt from Acme #1849-2210'],
    ]);
  });
});

describe('what the page address says (Hard Rule 6: no false DEGRADED on a list)', () => {
  const empty = messagePage({ subject: null, messages: [] });
  const health = (url: string) => withPage(empty, url, (doc) => receiptObserver.health(doc));
  const base = 'https://mail.google.com/mail/u/0/#';

  it.each([
    ['a label named with 24+ letters', 'label/ImportantReceiptsFromVendors2026'],
    ['a one-word search of 24+ letters', 'search/supercalifragilisticexpialidocious'],
    ['a label named with 16 hex digits', 'label/deadbeefdeadbeef'],
    ['a category tab', 'category/promotions'],
  ])('%s is a list view: OK', (_case, fragment) => {
    expect(health(`${base}${fragment}`)).toEqual({ status: 'OK' });
  });

  it.each([
    ['from the inbox', 'inbox/FMfcgzZGxrXxHGLCpWxRpfXgzvWhpWHb'],
    ['from a label', 'label/Receipts/FMfcgzZGxrXxHGLCpWxRpfXgzvWhpWHb'],
    ['from a search', 'search/stripe+receipt/FMfcgzZGxrXxHGLCpWxRpfXgzvWhpWHb'],
    ['by its legacy id', 'all/1a0fe435260eb853'],
  ])('a thread opened %s with no message on the page is DEGRADED', (_case, fragment) => {
    expect(health(`${base}${fragment}`)).toEqual({
      status: 'DEGRADED',
      reasons: ['selector.missing.subject', 'selector.missing.message'],
    });
  });
});

describe('a registry sender is matched by domain, and only its receipts are receipts', () => {
  const total = rows([['Order Total:', '$64.27']]);

  it.each([
    'Your Amazon.com order #112-4567890-1234567 has been delayed',
    'Your Amazon.com order #112-4567890-1234567: payment declined',
    'Your Amazon.com order of "Earbuds" has a delivery update',
    'Your Amazon.com order #112-4567890-1234567 - action required',
  ])('"%s" is not a purchase', (subject) => {
    expect(verdictsOf(subject, 'auto-confirm@amazon.com', total).map((v) => v.verdict)).toEqual([
      { kind: 'none' },
    ]);
  });

  it.each(['billing@notstripe.com', 'billing@stripe.co', 'billing@stripe.com.example'])(
    '%s only resembles a registry domain: it is not the Stripe parser',
    (from) => {
      expect(verdictsOf('Your receipt from Acme #1', from, total).map((v) => v.parser)).not.toContain(
        'stripe',
      );
    },
  );

  it('a display name wrapped across lines is one line, so the row is never refused', () => {
    const page = {
      subject: 'Order #1047 confirmed',
      messages: [
        {
          from: 'store+1@t.shopifyemail.com',
          name: ' Larkspur \n  Tea Co. ',
          body: rows([['Total', '$52.45']]),
        },
      ],
    };
    const plan = onPage(page, (doc) =>
      planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
    );
    expect(plan.status).toBe('OK');
    expect(plan.observations.map((o) => o.merchant)).toEqual(['Larkspur Tea Co.']);
  });

  it('a generic receipt with no subject keeps no subject hint (Gmail’s placeholder is interface text)', () => {
    const page = {
      subject: '(no subject)',
      messages: [
        { from: 'orders@corner-shop.example', name: 'Corner Shop', body: rows([['Total', '$12.34']]) },
      ],
    };
    const plan = onPage(page, (doc) =>
      planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
    );
    expect(plan.observations).toHaveLength(1);
    expect(plan.observations[0]?.subjectHint).toBeUndefined();
    expect(plan.observations[0]?.amountCents).toBe(1234);
  });
});

describe('which line and which date cell decide', () => {
  it.each([
    ['before', ['Total', '$49.00'] as const, ['Amount paid', '$39.00'] as const],
    ['after', ['Amount paid', '$39.00'] as const, ['Total', '$49.00'] as const],
  ])(
    'the most preferred label decides, a less preferred one %s it with another amount is ignored',
    (_case, first, second) => {
      const body = rows([first, ['Applied balance', '-$10.00'], second]);
      expect(minorOf('Your receipt from Acme #1849-2210', 'receipts@stripe.com', body, 'Acme')).toBe(3900);
    },
  );

  it('the titled date cell is the date, even after another header grid cell without a title', () => {
    const html = messagePage({
      subject: UBER,
      messages: [{ from: 'noreply@uber.com', body: rows([['Total', '$23.84']]) }],
    });
    const extra = html.replace(
      '</td><td><div',
      '</td><td><span role="gridcell" tabindex="-1">Important</span><div',
    );
    expect(extra).not.toBe(html);
    const plan = withPage(extra, THREAD_URL, (doc) =>
      planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
    );
    expect(plan.status).toBe('OK');
    expect(plan.observations.map((o) => o.occurredAt)).toEqual(['2026-10-02T16:17:00-04:00']);
    expect(plan.status === 'OK' && plan.coverage.map((c) => [c.windowStart, c.windowEnd])).toEqual([
      ['2026-10-02T16:17:00-04:00', '2026-10-02T16:17:00-04:00'],
    ]);
  });
});
