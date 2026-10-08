/**
 * The re-fake of a committed capture (tests/tools/capture-refake.ts; security review SEC-L2): the value rules run again
 * over a page faked with the public seed, keyed by a secret, so what could be recovered (amounts, cards, phone numbers,
 * addresses, labelled ids and codes, Meet codes, attribute UUIDs) is re-faked in its shape, and what only confirms a
 * guess (emails, names) stays, with the seeded secrets and Gmail's own ids. Every value below is invented.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CaptureError } from '../../tools/capture-error';
import { main, refakeHtml } from '../../tools/capture-refake';

const SEED = 'a'.repeat(64);
const page = (body: string): string =>
  `<!DOCTYPE html>\n<html><head><title>t</title></head><body><div role="main">${body}</div></body></html>\n`;

const RECEIPT = page(
  '<h2 data-legacy-thread-id="19ed294786971681">Your receipt #1234-5678</h2>' +
    '<p>From billing@example.com, Tara Sample</p>' +
    '<table><tr><td>Receipt number</td><td>1234-5678</td></tr>' +
    '<tr><td>Payment method</td><td><img alt="Visa"> 4242</td></tr>' +
    '<tr><td>Total</td><td>$12.34</td></tr></table>' +
    '<p>Pickup 742 Evergreen Terrace, Springfield, OR 97477</p>' +
    '<img id="m_1map_deadbeef-0000-4000-8000-feedface0001_wide" alt="map">' +
    '<span data-attest-seeded="phone_number">+1 (541) 555-0187</span>',
);

describe('refakeHtml', () => {
  it('re-fakes what a public-seed fake gives away, in its shape, and keeps emails, names, seeds and Gmail ids', () => {
    const out = refakeHtml(RECEIPT, { seed: SEED }).html;
    for (const old of ['1234-5678', '4242', '12.34', '742 Evergreen', 'deadbeef'])
      expect(out).not.toContain(old);
    expect(out).toMatch(/<h2 data-legacy-thread-id="19ed294786971681">Your receipt #\d{4}-\d{4}<\/h2>/u);
    expect(out).toMatch(/<td>Total<\/td><td>\$\d{2}\.\d{2}<\/td>/u);
    expect(out).toContain('<p>From billing@example.com, Tara Sample</p>');
    // A sender address keeps its '@' (no stray-'@' rule runs where emails are left as they are).
    expect(refakeHtml(page('<p>receipts@t.shopifyemail.com</p>'), { seed: SEED }).html).toContain(
      '<p>receipts@t.shopifyemail.com</p>',
    );
    expect(out).toContain('<span data-attest-seeded="phone_number">+1 (541) 555-0187</span>');
  });

  it('is pure: one seed, one result; another seed, other fakes; a page with nothing to fake comes back byte for byte', () => {
    expect(refakeHtml(RECEIPT, { seed: SEED }).html).toBe(refakeHtml(RECEIPT, { seed: SEED }).html);
    expect(refakeHtml(RECEIPT, { seed: 'b'.repeat(64) }).html).not.toBe(
      refakeHtml(RECEIPT, { seed: SEED }).html,
    );
    const plain = page('<p>Nothing here</p>');
    expect(refakeHtml(plain, { seed: SEED }).html).toBe(plain);
  });

  it('re-fakes a Meet code anywhere on a Calendar page, and a value named with `also` wherever it stands alone', () => {
    const calendar = refakeHtml(page('<p>Join: qrs-tuvw-xyz</p>'), {
      seed: SEED,
      pageUrl: 'https://calendar.google.com/',
    });
    expect(calendar.html).not.toContain('qrs-tuvw-xyz');
    const also = refakeHtml(
      page('<title-like>Umber 54321 confirmed</title-like><p title="54321">x 54321</p>'),
      {
        seed: SEED,
        also: ['54321'],
      },
    );
    expect(also.html).not.toContain('54321');
  });

  it('gives every copy of an old fake the same new one, also where no rule saw it (an ending alone in its span)', () => {
    const out = refakeHtml(
      page(
        '<table><tr><td>Payment method</td><td>4242</td></tr></table><p>Your Visa <span>4242</span> card was charged</p>',
      ),
      { seed: SEED },
    ).html;
    expect(out).not.toContain('4242');
    const fake = /<td>Payment method<\/td><td>(\d{4})<\/td>/u.exec(out)?.[1] ?? '?';
    expect(out).toContain(`<span>${fake}</span> card was charged`);
  });

  it('records what replaced what, for the labels (never written into the repository)', () => {
    const { made } = refakeHtml(RECEIPT, { seed: SEED });
    expect(made).toContainEqual(expect.objectContaining({ kind: 'amount', original: '12.34' }));
    expect(made).toContainEqual(expect.objectContaining({ kind: 'identifier', original: '1234-5678' }));
  });
});

describe('the re-fake command', () => {
  it('refuses a record inside the repository: the record holds the old fakes', async () => {
    const inside = path.resolve('tests', 'refake-record.json');
    await expect(main(['--record', inside, 'missing.html'])).rejects.toThrow(CaptureError);
  });
});
