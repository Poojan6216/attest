/**
 * Card endings and order numbers in a receipt's table rows (tests/tools/capture-rows.ts; review of the receipt
 * captures, 2026-10-07). A Stripe receipt writes "Payment method" in one cell and the card's brand (an image's alt
 * text) with "- 5454" in the next, and its invoice number, whose prefix is the customer's, beside "Invoice number":
 * no text node held both the words and the digits, so both survived. Rows are read whole now.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { sanitizeHtml, type SeedSecret } from '../../tools/sanitize';

let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

/** Stripe's receipt rows, in the structure captured (every value is invented). */
const RECEIPT = `
<table><tbody><tr><td><table><tbody>
  <tr><td><span>Receipt number</span></td><td></td><td align="right"><span>1234-5678</span></td></tr>
  <tr><td><span>Invoice number</span></td><td></td><td align="right"><span>TESTCUST-0001</span></td></tr>
  <tr><td><span>Date paid</span></td><td></td><td align="right"><span>May 7, 2025</span></td></tr>
  <tr><td><span>Payment method</span></td><td></td>
    <td align="right"><span><span><img alt="Mastercard" width="75"></span><span> - 5454</span></span></td></tr>
  <tr><td><span>Order #</span></td><td><span>112-3456789-1234567</span></td></tr>
</tbody></table></td></tr></tbody></table>`;

function sanitized(html: string): string {
  const page = `<!doctype html><html><head><title>t</title></head><body><div role="main">${html}</div></body></html>`;
  return sanitizeHtml(page, { seed: 'rows', seeds: SEEDS, pageUrl: 'https://mail.google.com/mail/u/0/' })
    .html;
}

/** The text of the cell after `label`'s, in `html`. */
function valueAfter(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  const rest = html.slice(at);
  const value = /<td align="right"><span>([^<]*)<\/span>|<td><span>([^<]*)<\/span><\/td><\/tr>/u.exec(rest);
  return value?.[1] ?? value?.[2] ?? '';
}

describe('a card ending in a table row whose words or images name a card (capture-rows.ts)', () => {
  it("fakes Stripe's '- 5454' after a Mastercard logo, in the row 'Payment method'", () => {
    const out = sanitized(RECEIPT);
    expect(out).not.toContain('5454');
    expect(out).toMatch(/<span> - \d{4}<\/span>/u);
  });

  it('fakes an ending whose only clue is the brand in an image', () => {
    const out = sanitized('<table><tr><td><img alt="Visa"></td><td>4242</td></tr></table>');
    expect(out).not.toContain('4242');
    expect(out).toMatch(/<td>\d{4}<\/td>/u);
  });

  it("fakes an ending in the cell after 'Payment method': the cells' words do not run together", () => {
    const out = sanitized('<table><tr><td>Payment method</td><td>4242</td></tr></table>');
    expect(out).not.toContain('4242');
    expect(out).toMatch(/<td>Payment method<\/td><td>\d{4}<\/td>/u);
  });

  it("leaves the digits of a row that names no card (a year, a quantity) and a row's longer texts", () => {
    const out = sanitized(
      '<table><tr><td>Date paid</td><td>2025</td></tr><tr><td>Payment method</td><td>Paid 2025 in full</td></tr></table>',
    );
    expect(out).toContain('<td>Date paid</td><td>2025</td>');
    expect(out).toContain('Paid 2025 in full');
  });

  it('reads only rows that hold no other row: the outer row of a whole receipt is no card row', () => {
    expect(valueAfter(sanitized(RECEIPT), 'Date paid')).toBe('May 7, 2025');
    const nested = sanitized(
      '<table><tr><td>Payment method on file</td><td><table><tr><td>Credits</td><td>1500</td></tr></table></td></tr></table>',
    );
    expect(nested).toContain('<td>Credits</td><td>1500</td>');
  });
});

describe('an order number beside its label (capture-rows.ts)', () => {
  it('fakes receipt, invoice and order numbers in their own shape', () => {
    const out = sanitized(RECEIPT);
    for (const real of ['1234-5678', 'TESTCUST-0001', '112-3456789-1234567']) expect(out).not.toContain(real);
    expect(valueAfter(out, 'Receipt number')).toMatch(/^\d{4}-\d{4}$/u);
    expect(valueAfter(out, 'Invoice number')).toMatch(/^[A-Z]{8}-\d{4}$/u);
    expect(valueAfter(out, 'Order #')).toMatch(/^\d{3}-\d{7}-\d{7}$/u);
  });

  it('gives every other copy of the number on the page the same fake: the subject, a title, the header', () => {
    const out = sanitized(
      `<h2 data-legacy-thread-id="18f2">Your receipt from Eleven Labs Inc. #1234-5678</h2>
       <span title="Receipt #1234-5678">Receipt #1234-5678</span>${RECEIPT}`,
    );
    const fake = valueAfter(out, 'Receipt number');
    expect(out).not.toContain('1234-5678');
    expect(out).toContain(`Your receipt from Eleven Labs Inc. #${fake}</h2>`);
    expect(out).toContain(`<span title="Receipt #${fake}">Receipt #${fake}</span>`);
  });

  it('replaces a number only where it stands alone, never inside a longer id', () => {
    const out = sanitized(
      `<div data-id="a1234-5678b" data-head="x1234-5678" data-tail="1234-56785">x</div>${RECEIPT}`,
    );
    expect(out).toContain('data-id="a1234-5678b"');
    expect(out).toContain('data-head="x1234-5678"');
    expect(out).toContain('data-tail="1234-56785"');
  });

  it("is set off only by a whole label: an order's date or a sentence keeps its year; no digit, no number", () => {
    const out = sanitized(
      '<table><tr><td>Order date</td><td>May 7, 2025</td></tr>' +
        '<tr><td>Thanks for your order</td><td>placed May 8, 2025</td></tr>' +
        '<tr><td>Order number</td><td>Pending review</td></tr></table>',
    );
    expect(out).toContain('<td>May 7, 2025</td>');
    expect(out).toContain('<td>placed May 8, 2025</td>');
    expect(out).toContain('<td>Pending review</td>');
  });

  it('is deterministic: the same page and seed give the same fakes', () => {
    expect(sanitized(RECEIPT)).toBe(sanitized(RECEIPT));
  });
});

describe('a code or an order number beside its label, outside a table row (capture-rows.ts)', () => {
  it("fakes Instacart's referral code in the span after 'Copy code:', in its own shape", () => {
    const out = sanitized('<div><span>Copy code:</span><span>R123456</span></div>');
    expect(out).not.toContain('R123456');
    expect(out).toMatch(/<span>Copy code:<\/span><span>[A-Z]\d{6}<\/span>/u);
  });

  it('skips empty elements to the next element with text, and stops at the last child', () => {
    const out = sanitized(
      '<p><span>Order #</span><span></span><b>W-55512</b></p><p><span>Referral code</span></p>',
    );
    expect(out).not.toContain('W-55512');
    expect(out).toMatch(/<b>[A-Z]-\d{5}<\/b>/u);
    expect(out).toContain('<span>Referral code</span>');
  });

  it('is set off only by an element whose whole text is a label', () => {
    const out = sanitized('<div><span>Code of conduct</span><span>Rev 2025A</span></div>');
    expect(out).toContain('<span>Rev 2025A</span>');
  });
});

describe('a postal address after its label (capture-rows.ts)', () => {
  /** Shopify's order confirmation, in the structure captured (every value is invented). */
  const SHOPIFY = `<table><tr>
    <td class="m_-12customer-info__item"><h4>Shipping address</h4><p>Tara Sample<br>
      <a href="https://www.google.com/">9/9 Fixture Nagar, Testpur</a><br><a href="https://www.google.com/">999999 Placeholderabad</a> ZZ<br>India</p></td>
    <td class="m_-12customer-info__item"><h4>Billing address:</h4><p>Tara Sample</p></td>
    <td><h4>Shipping method</h4><p>Free Shipping</p></td></tr></table>`;

  it("turns every text after 'Shipping address' and 'Billing address:' into a phrase of as many words", () => {
    const out = sanitized(SHOPIFY);
    for (const real of ['Tara', 'Sample', 'Fixture', 'Testpur', '999999', 'Placeholderabad', 'ZZ', 'India'])
      expect(out).not.toContain(real);
    expect(out).toContain('<h4>Shipping address</h4>');
    expect(out).toMatch(/<h4>Billing address:<\/h4><p>[A-Z][a-z]+ [a-z]+<\/p>/u);
  });

  it('leaves what follows any other label, and a sentence about an address', () => {
    const out = sanitized(
      `${SHOPIFY}<div><span>Your address is safe with us</span><span>Tara Sample</span></div><div><a>Change your shipping address</a><span>Mira Example</span></div>`,
    );
    expect(out).toContain('<h4>Shipping method</h4><p>Free Shipping</p>');
    expect(out).toContain('<span>Tara Sample</span>');
    expect(out).toContain('<span>Mira Example</span>');
  });
});

describe("rupee amounts written 'Rs.' (capture-pii.ts CURRENCY)", () => {
  it('fakes them like any amount, keeping the sign, the spacing and the decimals', () => {
    const out = sanitized('<p>Subtotal Rs. 100.00</p><p>Taxes Rs.12.34</p>');
    expect(out).not.toContain('100.00');
    expect(out).not.toContain('12.34');
    expect(out).toMatch(/<p>Subtotal Rs\. \d{3}\.\d{2}<\/p><p>Taxes Rs\.\d{2}\.\d{2}<\/p>/u);
  });
});

describe('an order number in the row under its label, and an id a <wbr> splits (capture-rows.ts)', () => {
  /** Spotify's receipt, in the structure captured (the id is invented): the label's row, then the id's row, split by a <wbr>. */
  const SPOTIFY =
    '<table><tr><td width="5%"></td><td>Invoice ID</td></tr>' +
    '<tr><td width="5%"></td><td>deadbeef-0000-4000-8000-<wbr>feedface0001</td></tr></table>';

  it('fakes the id in the row under a row whose only text is the label, both halves, in its shape', () => {
    const out = sanitized(SPOTIFY);
    expect(out).not.toContain('deadbeef');
    expect(out).not.toContain('feedface0001');
    expect(out).toMatch(/<td>[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-<wbr>[a-z\d]{12}<\/td>/u);
  });

  it('gives a copy of the id elsewhere, whole, the same fake', () => {
    const out = sanitized(`${SPOTIFY}<p>Invoice deadbeef-0000-4000-8000-feedface0001 is attached</p>`);
    const half = /<td>([a-z\d-]+)<wbr>([a-z\d]{12})<\/td>/u.exec(out);
    expect(out).toContain(`<p>Invoice ${half?.[1] ?? '?'}${half?.[2] ?? '?'} is attached</p>`);
  });

  it('reads a row above as a label only when its one text is a label', () => {
    const out = sanitized(
      '<table><tr><td>Thanks</td></tr><tr><td>A1234-XY</td></tr>' +
        '<tr><td>Invoice ID</td><td>and more</td></tr><tr><td>B5678-ZZ</td></tr></table>',
    );
    expect(out).toContain('<td>A1234-XY</td>');
    expect(out).toContain('<td>B5678-ZZ</td>');
  });
});

describe('a label and its value in one text (capture-rows.ts)', () => {
  it("fakes Gap's coupon code after 'Code', and an order number after 'Order Confirmation #' or 'Order'", () => {
    const out = sanitized(
      '<table><tr><td class="x_coupon-code">Code ABCDE12FG3HI</td></tr></table>' +
        '<h2>Order Confirmation #1ABCDEF</h2><p>Order 54321 confirmed</p>',
    );
    for (const real of ['ABCDE12FG3HI', '1ABCDEF', '54321']) expect(out).not.toContain(real);
    expect(out).toMatch(/>Code [A-Z]{5}\d{2}[A-Z]{2}\d[A-Z]{2}</u);
    expect(out).toMatch(/<h2>Order Confirmation #\d[A-Z]{6}<\/h2><p>Order \d{5} confirmed<\/p>/u);
  });

  it('leaves a label followed by words without digits, and digits after other words', () => {
    const out = sanitized(
      '<p>Your Instacart order receipt</p><p>Offer ends 10/7/26</p><p>A code of conduct 2025</p>' +
        '<p>Preorder 12345 units</p>',
    );
    expect(out).toContain('<p>Your Instacart order receipt</p>');
    expect(out).toContain('<p>Offer ends 10/7/26</p>');
    expect(out).toContain('<p>A code of conduct 2025</p>');
    expect(out).toContain('<p>Preorder 12345 units</p>');
  });
});

describe('a Google Meet code (capture-rows.ts; the invitation week of 2026-10-07)', () => {
  it("fakes the code in a label that names Meet, and in the page's other copies of it", () => {
    const out = sanitized(
      '<div aria-label="Join with Google Meet (abc-defg-hij)"><span>Join with Google Meet</span></div>' +
        '<p>Code abc-defg-hij</p>',
    );
    expect(out).not.toContain('abc-defg-hij');
    expect(out).toMatch(/aria-label="Join with Google Meet \([a-z]{3}-[a-z]{4}-[a-z]{3}\)"/u);
  });

  it('leaves the same shape where nothing names Meet', () => {
    expect(sanitized('<p>A one-time-use code</p>')).toContain('<p>A one-time-use code</p>');
  });
});

describe('the cases the security review found the rules kept whole (SEC-L3, SEC-L4)', () => {
  it('fakes an id after the other labels of one text: tracking, booking reference, membership, ticket', () => {
    const out = sanitized(
      '<p>Tracking number 1Z999AA10123456784</p><p>Booking reference: AB12CD34</p>' +
        '<p>Membership ID 12345678</p><p>Ticket number 7781234</p>',
    );
    for (const id of ['1Z999AA10123456784', 'AB12CD34', '12345678', '7781234']) expect(out).not.toContain(id);
    expect(out).toMatch(/<p>Tracking number \d[A-Z]\d{3}[A-Z]{2}\d{11}<\/p>/u);
    expect(out).toMatch(/<p>Booking reference: [A-Z]{2}\d{2}[A-Z]{2}\d{2}<\/p>/u);
  });

  it('on a Calendar page fakes every Meet-shaped code, also where nothing names Meet; elsewhere only beside Meet', () => {
    const page = (url: string) =>
      sanitizeHtml(
        '<!doctype html><html><head><title>t</title></head><body><div role="main"><p>Join: qrs-tuvw-xyz</p></div></body></html>',
        { seed: 'rows', seeds: SEEDS, pageUrl: url },
      ).html;
    expect(page('https://calendar.google.com/calendar/u/0/r/week')).not.toContain('qrs-tuvw-xyz');
    expect(page('https://calendar.google.com/calendar/u/0/r/week')).toMatch(
      /<p>Join: [a-z]{3}-[a-z]{4}-[a-z]{3}<\/p>/u,
    );
    expect(page('https://mail.google.com/mail/u/0/')).toContain('<p>Join: qrs-tuvw-xyz</p>');
  });

  it('fakes every block of an address after its label, and stops at the next label, heading, table or amount', () => {
    const out = sanitized(
      '<div><p>Ship to</p><p>Tara Sample</p><p>9 Fixture Road</p><p>Testpur 999999</p>' +
        '<p>Total $12.00</p><p>Mira Example</p></div><div><p>Billing address</p><p>Tara Sample</p><h3>Items</h3><p>Pens</p></div>',
    );
    for (const real of ['Tara', 'Fixture Road', 'Testpur', '999999']) expect(out).not.toContain(real);
    expect(out).toContain('<p>Mira Example</p>');
    expect(out).toContain('<h3>Items</h3><p>Pens</p>');
    expect(out).toMatch(/<p>Total \$\d{2}\.\d{2}<\/p>/u);
  });

  it("fakes a UUID in an attribute (a trip's map image id), the same in every copy, never in Gmail's own ids", () => {
    const uuid = 'deadbeef-0000-4000-8000-feedface0001';
    const out = sanitized(
      `<img id="m_123map_${uuid}_wide" alt="map"><a title="${uuid}">x</a>` +
        '<span data-legacy-thread-id="19ed294786971681" data-legacy-last-message-id="19ed2952e2b6998a">s</span>',
    );
    expect(out).not.toContain(uuid);
    const fake = /id="m_123map_([0-9a-f-]{36})_wide"/u.exec(out)?.[1] ?? '?';
    expect(fake).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(out).toContain(`<a title="${fake}">`);
    expect(out).toContain(
      'data-legacy-thread-id="19ed294786971681" data-legacy-last-message-id="19ed2952e2b6998a"',
    );
  });
});
