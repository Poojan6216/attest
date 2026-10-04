/**
 * The fixture sanitiser and real receipt captures (sprint_2 2.3; tests/tools/sanitize.ts `keepSenders`).
 *
 *  - an address at a receipt-parser registry domain (src/observers/gmail/receipts/selectors.json) keeps its domain,
 *    with a fake local part (a local part can name a person or carry a token); a business's display name at a
 *    business-name domain is kept too (a `+tag` machine sender, or a name holding a registry brand), never a
 *    person's, the signed-in account's included; every other address and name is faked as before, lookalikes
 *    included;
 *  - so a sanitised receipt page is still claimed by the same parser (each labelled receipt fixture, sanitised as if
 *    it were a capture), and a sanitised negative still is not;
 *  - `pickSeeds` never injects a seed holding a URL query (`url_with_token`), which SECURITY-2 forbids in a
 *    committed fixture.
 */
import { readFileSync } from 'node:fs';

import { type Document, Window } from 'happy-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { RECEIPT_SENDER_DOMAINS, receiptVerdicts } from '../../../src/observers/gmail/receipts';
import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { findForeignAts } from '../../tools/capture-pii';
import {
  pickSeeds,
  RECEIPT_SENDERS,
  sanitizeHtml,
  type SanitizeOptions,
  type SeedSecret,
} from '../../tools/sanitize';
import { gmailFixtures, withPage } from '../observers/receipts/receipt-fixtures';

let SEEDS: SeedSecret[] = [];
beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

const page = (body: string): string =>
  `<!doctype html><html><head><title>t</title></head><body><div role="main">${body}</div></body></html>`;

function run(body: string, options: Partial<SanitizeOptions> = {}): string {
  return sanitizeHtml(page(body), { seed: 'receipts', seeds: SEEDS, ...options }).html;
}

function dom(html: string): Document {
  return new new Window().DOMParser().parseFromString(html, 'text/html');
}

const sender = (address: string, name: string): string =>
  `<h3><span email="${address}" name="${name}" data-hovercard-id="${address}"><span>${name}</span></span> <span>&lt;${address}&gt;</span></h3>`;

/** The `email` attribute of the first sender span of a sanitised page. */
const senderAddress = (out: string): string => dom(out).querySelector('[email]')?.getAttribute('email') ?? '';

describe('registry senders keep their domain', () => {
  it('a Stripe sender keeps its domain (local part faked, every copy alike) and its display name, the merchant', () => {
    const out = run(sender('receipts+acct_1Q9fZxLm2Kp4@stripe.com', 'Acme Analytics, Inc.'));
    const span = dom(out).querySelector('[email]');
    const address = span?.getAttribute('email') ?? '';
    expect(address).toMatch(/^[a-z]+\.[a-z]+@stripe\.com$/u);
    expect(span?.getAttribute('data-hovercard-id')).toBe(address);
    expect(span?.getAttribute('name')).toBe('Acme Analytics, Inc.');
    expect(out).toContain(`&lt;${address}&gt;`);
    expect(out).not.toContain('receipts');
    expect(out).not.toContain('acct_1Q9fZxLm2Kp4');
    expect(findForeignAts(out, RECEIPT_SENDERS.domains)).toEqual([]);
  });

  it('a subdomain of a registry domain keeps its domain (Shopify store mail), with the store name', () => {
    const out = run(sender('store+61234567@t.shopifyemail.com', 'Larkspur Tea Co.'));
    expect(senderAddress(out)).toMatch(/@t\.shopifyemail\.com$/u);
    expect(out).not.toContain('61234567');
    expect(out).toContain('Larkspur Tea Co.');
  });

  it('a brand display name is kept beside a plain machine address (receipt subjects name the brand)', () => {
    const out = run(sender('auto-confirm@amazon.com', 'Amazon.com'));
    expect(senderAddress(out)).toMatch(/@amazon\.com$/u);
    expect(out).not.toContain('auto-confirm');
    expect(dom(out).querySelector('[email]')?.getAttribute('name')).toBe('Amazon.com');
  });

  it('a facebookmail.com address keeps its domain, but its display name (it can be a person) is faked', () => {
    const out = run(sender('notification+zrdo8xgx88ox@facebookmail.com', 'Jane Doe'));
    expect(senderAddress(out)).toMatch(/@facebookmail\.com$/u);
    expect(out).not.toContain('notification');
    expect(out).not.toContain('Jane Doe');
    expect(out).not.toContain('zrdo8xgx88ox');
  });
});

describe('people at registry domains are faked (Hard Rules 2, 10)', () => {
  it.each([
    ['an employee writing from a plain address', 'jane.doe@uber.com', 'Jane Doe'],
    ['a Stripe employee', 'sam.lee@stripe.com', 'Sam Lee'],
    ['a recipient in a sent list', 'pat.kim@opentable.com', 'Pat Kim'],
  ])('%s: the local part and the name are faked, only the domain stays', (_case, address, name) => {
    const out = run(sender(address, name));
    expect(out).not.toContain(address.slice(0, address.indexOf('@')));
    expect(out).not.toContain(name);
    expect(senderAddress(out)).toMatch(new RegExp(`@${address.slice(address.indexOf('@') + 1)}$`, 'u'));
  });

  it('the signed-in account at a registry domain is faked, name and local part', () => {
    const switcher =
      '<header role="banner"><a aria-label="Google Account: Avery Founder&#10;(avery@stripe.com)">A</a></header>';
    const out = run(switcher);
    expect(out).not.toContain('Avery Founder');
    expect(out).not.toContain('avery@');
  });

  it('a relay address under a registry subdomain (Amazon buyer-seller mail) keeps no token', () => {
    const out = run('<p>Write to 2x9z8q7w6e5r4t3@marketplace.amazon.com</p>');
    expect(out).not.toContain('2x9z8q7w6e5r4t3');
    expect(out).toMatch(/@marketplace\.amazon\.com/u);
  });
});

describe('everyone else is faked, as before', () => {
  it.each([
    ['a sender outside the registry', 'orders@northwind.example'],
    ['a lookalike domain that only starts like one', 'receipts@stripe.com.pay.example'],
  ])('%s is faked, with its display name', (_case, address) => {
    const out = run(sender(address, 'Northwind Outfitters'));
    expect(out).not.toContain(address);
    expect(out).not.toContain('Northwind Outfitters');
    expect(findForeignAts(out)).toEqual([]);
  });

  it('a registry domain written with a Cyrillic letter is never kept: its @ is neutralised like any stray one', () => {
    const address = 'receipts@str\u0456pe.com';
    const out = run(sender(address, 'Acme'));
    expect(out).not.toContain(address);
    expect(findForeignAts(out, RECEIPT_SENDERS.domains)).toEqual([]);
  });

  it('a person who shares a word with a kept business name is still faked, whole', () => {
    const body = `${sender('store+1@t.shopifyemail.com', 'Larkspur Tea Co.')}<p>Larkspur Smith &lt;ls@corp.example&gt;</p>`;
    const out = run(body);
    expect(out).toContain('Larkspur Tea Co.');
    expect(out).not.toContain('Larkspur Smith');
  });

  it('keepSenders with no domains fakes every address, as before', () => {
    const out = run(sender('receipts@stripe.com', 'Acme Analytics, Inc.'), {
      keepSenders: { domains: [], nameDomains: [] },
    });
    expect(out).not.toContain('stripe.com');
    expect(findForeignAts(out)).toEqual([]);
  });

  it('the final @ check accepts registry domains only when they are kept', () => {
    expect(findForeignAts('a@stripe.com b@x.t.shopifyemail.com', RECEIPT_SENDER_DOMAINS)).toEqual([]);
    expect(findForeignAts('a@stripe.com', [])).toEqual([1]);
    expect(findForeignAts('a@stripe.company', RECEIPT_SENDER_DOMAINS)).toEqual([1]);
  });
});

describe('a sanitised receipt capture stays parseable', () => {
  const receipts = gmailFixtures().filter(
    (f) => f.page.view === 'gmail.message' && f.page.folder === 'inbox',
  );

  it.each(receipts.map((f) => [f.file, f] as const))('%s', (_file, f) => {
    const before = withPage(readFileSync(f.htmlPath, 'utf8'), f.page.liveUrl, receiptVerdicts);
    const sanitised = sanitizeHtml(readFileSync(f.htmlPath, 'utf8'), { seed: f.file, seeds: SEEDS }).html;
    const after = withPage(sanitised, f.page.liveUrl, receiptVerdicts);
    expect(after.map((v) => [v.parser, v.verdict.kind])).toEqual(
      before.map((v) => [v.parser, v.verdict.kind]),
    );
    const merchant = (v: (typeof before)[number] | undefined) =>
      v?.verdict.kind === 'receipt' ? v.verdict.facts.merchant : undefined;
    if (before[0]?.parser !== 'generic') expect(merchant(after[0])).toBe(merchant(before[0]));
  });
});

describe('pickSeeds never injects a URL with a token (SECURITY-2)', () => {
  it('url_with_token is never chosen, whatever the seed', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(pickSeeds(SEEDS, `seed-${String(i)}`).map((s) => s.id)).not.toContain('url_with_token');
    }
  });

  it('any seed with a query or a parameter fragment is skipped; a plain URL path is not', () => {
    const extra: SeedSecret[] = [
      { id: 'query', value: 'https://files.example.net/s?token=abc', canaries: [] },
      { id: 'fragment', value: 'https://files.example.net/cb#access_token=abc', canaries: [] },
      { id: 'path', value: 'https://files.example.net/share/q3-deck', canaries: [] },
    ];
    const chosen = new Set(
      Array.from({ length: 300 }, (_, i) => pickSeeds([...extra, ...SEEDS], `s${String(i)}`))
        .flat()
        .map((s) => s.id),
    );
    expect(chosen.has('query') || chosen.has('fragment')).toBe(false);
    expect(chosen.has('path')).toBe(true);
  });
});
