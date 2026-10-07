/**
 * Links to other sites, contact links and card endings (security re-review of the captures of 2026-10-06, SEC-R1
 * to R3 and R6). A tracking link's path held the founder's address, compressed and base64url-encoded; Google Maps
 * links held two trip addresses; a `tel:` link held a phone number behind `%20`; receipts printed card endings. A
 * link to anywhere but the captured page's own host now keeps only scheme and host, a contact link only its scheme,
 * and a card ending after a mask or "ending in" is faked like a card.
 */
import { deflateSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { pageHostOf, trimForeignLink } from '../../tools/capture-url';
import { sanitizeHtml, type SanitizeOptions, type SeedSecret } from '../../tools/sanitize';

let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

const PAGE_URL = 'https://mail.google.com/mail/u/0/#inbox/abc';

/** A click-tracking path segment as Uber's mail writes it: a query string, deflated, then base64url. */
const TRACKED = deflateSync(
  Buffer.from('r=jane.doe%40corp.io&mainRecipient=jane.doe%40corp.io&h=0a1b'),
).toString('base64url');

function body(html: string, options: Partial<SanitizeOptions> = { pageUrl: PAGE_URL }): string {
  const page = `<!doctype html><html><head><title>t</title></head><body><div role="main">${html}</div></body></html>`;
  return sanitizeHtml(page, { seed: 'links', seeds: SEEDS, ...options }).html;
}

describe('trimForeignLink', () => {
  it("keeps the page's own links, relative links and fragments whole", () => {
    expect(trimForeignLink('https://mail.google.com/mail/u/0/#sent', 'mail.google.com')).toBe(
      'https://mail.google.com/mail/u/0/#sent',
    );
    expect(trimForeignLink('/mail/u/1/#inbox', 'mail.google.com')).toBe('/mail/u/1/#inbox');
    expect(trimForeignLink('#inbox/FMfcgz', 'mail.google.com')).toBe('#inbox/FMfcgz');
  });

  it('cuts every other absolute link to its scheme and host, a protocol-relative one too', () => {
    expect(trimForeignLink(`https://email.mgt.uber.com/c/${TRACKED}`, 'mail.google.com')).toBe(
      'https://email.mgt.uber.com/',
    );
    expect(
      trimForeignLink('https://www.google.com/maps/search/1+Main+St,+Springfield', 'mail.google.com'),
    ).toBe('https://www.google.com/');
    expect(trimForeignLink('//cdn.example.net/a/b', 'mail.google.com')).toBe('https://cdn.example.net/');
  });

  it('keeps only the scheme of a contact link, whatever its case or escaping', () => {
    expect(trimForeignLink('tel:(555)%20123-4567', 'mail.google.com')).toBe('tel:');
    expect(trimForeignLink(' SMS:+15551234567', 'mail.google.com')).toBe('sms:');
  });

  it('with no page address, no link is the page’s own (fail closed)', () => {
    expect(pageHostOf(undefined)).toBeNull();
    expect(trimForeignLink('https://mail.google.com/mail/u/0/', null)).toBe('https://mail.google.com/');
  });
});

describe('sanitizeHtml on links and card endings', () => {
  it('a compressed address inside a tracking path and a place inside a maps path do not survive', () => {
    const out = body(
      `<a href="https://email.mgt.uber.com/c/${TRACKED}">Trip</a>` +
        '<a href="https://www.google.com/maps/search/123+Main+St,+Springfield,+IL+62704">Pickup</a>',
    );
    expect(out).not.toContain(TRACKED);
    expect(out).not.toContain('Main+St');
    expect(out).toContain('href="https://email.mgt.uber.com/"');
    expect(out).toContain('href="https://www.google.com/"');
  });

  it("keeps the page's own folder links, which the observers read", () => {
    expect(body('<a href="https://mail.google.com/mail/u/0/#sent">Sent</a>')).toContain(
      'href="https://mail.google.com/mail/u/0/#sent"',
    );
  });

  it('a phone number in a tel: link does not survive, escaped or not', () => {
    const out = body('<a href="tel:(555)%20123-4567">call</a><a href="tel:+1-555-123-4567">call</a>');
    expect(out).not.toMatch(/555|4567/);
    expect(out.match(/href="tel:"/g)).toHaveLength(2);
  });

  it.each([
    ['a mask of dots', 'Visa ••••4242 charged'],
    ['a spaced mask', 'Mastercard •••• 4242'],
    ['asterisks', 'card **** 4242'],
    ['"ending in"', 'Visa ending in 4242'],
  ])('a card ending after %s is faked', (_label, text) => {
    const out = body(`<p>${text}</p>`);
    expect(out).not.toContain('4242');
    expect(out).toMatch(/\d{4}/);
  });
});

describe('odd link forms, other schemes and written addresses (SEC-R11, SEC-R12)', () => {
  it.each([
    ['backslashes', 'https:\\\\email.mgt.uber.com\\c\\PATHTOKEN', 'https://email.mgt.uber.com/'],
    ['a tab inside the scheme', 'ht\ttps://email.mgt.uber.com/c/PATHTOKEN', 'https://email.mgt.uber.com/'],
    [
      'upper case and leading spaces',
      '  HTTPS://EMAIL.MGT.UBER.COM/c/PATHTOKEN',
      'https://email.mgt.uber.com/',
    ],
    // These two resolve to the page's own host (Chrome reads them so), but carry another site in their path.
    ['a single slash', 'https:/email.mgt.uber.com/c/PATHTOKEN', 'https://mail.google.com/'],
    ['no slash', 'https:email.mgt.uber.com/c/PATHTOKEN', 'https://mail.google.com/'],
    [
      'a tab inside a single-slash form',
      'ht\ttps:/email.mgt.uber.com/c/PATHTOKEN',
      'https://mail.google.com/',
    ],
  ])('a link written with %s keeps no path (SEC-R11)', (_label, href, kept) => {
    expect(trimForeignLink(href, 'mail.google.com')).toBe(kept);
  });

  it('any scheme but http(s) and mailto keeps only its scheme; a link that does not parse is dropped', () => {
    expect(trimForeignLink('geo:40.7,-74.0', 'mail.google.com')).toBe('geo:');
    expect(trimForeignLink('data:text/plain,hello', 'mail.google.com')).toBe('data:');
    expect(trimForeignLink('mailto:jane@corp.io', 'mail.google.com')).toBe('mailto:jane@corp.io');
    expect(trimForeignLink('https://[bad', 'mail.google.com')).toBe('');
  });

  it('an address written as text or in another attribute loses its path too (SEC-R12)', () => {
    const out = body(
      '<p data-src="https://inst.cr/t/REFCODE1">Get $10: https://inst.cr/t/REFCODE2 or www.inst.cr/t/REFCODE3</p>',
    );
    expect(out).not.toMatch(/REFCODE/u);
    expect(out).toContain('https://inst.cr/');
  });

  it('a // inside ordinary text is no address', () => {
    expect(body('<p>Q3 // plan and a//b</p>')).toContain('Q3 // plan and a//b');
  });
});

describe('card endings and handles (SEC-R14, SEC-R15)', () => {
  it.each([
    ['"Payment method -"', 'Payment method - 4242'],
    ['"Card ending:"', 'Card ending: 4242'],
    ['a narrow no-break space after the mask', 'Visa ••••\u202f4242'],
    ['a five-digit American Express ending', 'Amex ending in 12345'],
    ['a brand and brackets', 'Visa (4242)'],
  ])('a card ending after %s is faked (SEC-R14)', (_label, text) => {
    const out = body(`<p>${text}</p>`);
    expect(out).not.toMatch(/4242|12345/u);
  });

  it('a long line of mask characters is read in linear time (SEC-R14)', () => {
    const started = performance.now();
    body(`<p>${'•'.repeat(100_000)}4242</p>`);
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it('digits glued to a learned name (a handle) are faked with it (SEC-R15)', () => {
    const out = body('<p>Thanks, jane0403! Jane Doe</p>', { pageUrl: PAGE_URL, names: ['Jane Doe'] });
    expect(out).not.toMatch(/0403|jane/iu);
  });

  it('leaves four-digit numbers with no mask alone (years, store numbers)', () => {
    expect(body('<p>Since 2026, store 4242</p>')).toContain('Since 2026, store 4242');
  });
});
