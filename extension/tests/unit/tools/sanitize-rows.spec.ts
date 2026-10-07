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

/** Stripe's receipt rows, as captured (structure only; the values are made up). */
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
      `<div data-id="a2399-4422b" data-head="x2399-4422" data-tail="2399-44225">x</div>${RECEIPT}`,
    );
    expect(out).toContain('data-id="a2399-4422b"');
    expect(out).toContain('data-head="x2399-4422"');
    expect(out).toContain('data-tail="2399-44225"');
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
