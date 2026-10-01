import { type Document, Window } from 'happy-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { Faker, matchCase } from '../../tools/capture-fakes';
import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { findForeignAts, nameTokens } from '../../tools/capture-pii';
import { sanitizeHtml, type SanitizeOptions, type SeedSecret } from '../../tools/sanitize';

let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

function page(body: string): string {
  return `<!doctype html><html><head><title>t</title></head><body><div role="main">${body}</div></body></html>`;
}

/** Sanitises `body` and returns the main landmark's HTML without the injected seeds. */
function main(body: string, options: Partial<SanitizeOptions> = {}): string {
  const out = sanitizeHtml(page(body), { seed: 'pii', seeds: SEEDS, ...options }).html;
  const doc = dom(out);
  for (const seeded of Array.from(doc.querySelectorAll('[data-attest-seeded]'))) seeded.remove();
  return doc.querySelector('[role="main"]')?.innerHTML ?? '';
}

function dom(html: string): Document {
  return new new Window().DOMParser().parseFromString(html, 'text/html');
}

/** Digits → '9', letters kept: the visible "shape" of a phone number or amount. */
function shape(text: string): string {
  return text.replace(/\d/g, '9');
}

describe('emails', () => {
  it.each([
    ['plain text', 'Write to jane.doe@acme.co.uk today', 'jane.doe@acme.co.uk'],
    ['mailto href', '<a href="mailto:jane.doe@acme.co.uk">mail</a>', 'jane.doe@acme.co.uk'],
    ['title attribute', '<span title="jane.doe@acme.co.uk">j</span>', 'jane.doe@acme.co.uk'],
    ['data attribute', '<span data-hovercard-id="Jane.Doe@Acme.co.uk">j</span>', 'acme.co.uk'],
    ['input value', '<input value="jane.doe@acme.co.uk">', 'jane.doe@acme.co.uk'],
    ['plus addressing', 'cc sales+q3@north-wind.io', 'north-wind.io'],
  ])('%s → a fake on an example domain', (_label, body, original) => {
    const out = main(body);
    expect(out.toLowerCase()).not.toContain(original.toLowerCase());
    expect(out).toMatch(/[a-z]+\.[a-z]+@example\.(?:com|org|net)/);
    expect(findForeignAts(out)).toEqual([]);
  });

  it('maps the same address (any case, text or attribute) to one fake', () => {
    const out = main(
      '<span email="Ann.Lee@Acme.io">ann.lee@acme.io</span><a href="mailto:ANN.LEE@ACME.IO">x</a>',
    );
    const fakes = new Set(
      out.match(/[a-z0-9.]+@example\.(?:com|org|net)/gi)?.map((fake) => fake.toLowerCase()),
    );
    expect(fakes.size).toBe(1);
  });

  it('gives two different addresses two different fakes', () => {
    const out = main('ann@acme.io and bob@acme.io');
    expect(new Set(out.match(/[a-z0-9.]+@example\.(?:com|org|net)/g)).size).toBe(2);
  });

  it('replaces Latin-script (accented) addresses without eating neighbouring CJK text', () => {
    const out = main('<p>jöhn@exämple.de</p><p>連絡先はtaro@corp.jpです</p>');
    expect(out).not.toMatch(/jöhn|exämple|taro|corp\.jp|\uFF20/);
    expect(out).toMatch(
      /^<p>[a-z]+\.[a-z]+@example\.(?:com|org|net)<\/p><p>連絡先は[a-z.]+@example\.\w+です<\/p>$/,
    );
  });
});

describe('encoded emails (invisible to a search for "@")', () => {
  const plainFake = (out: string): string => /<b>([^<]+)<\/b>/.exec(out)?.[1] ?? '<none>';
  const b64url = (text: string): string => Buffer.from(text).toString('base64url');
  const decode = (token: string): string => Buffer.from(token, 'base64').toString('latin1');

  it('percent-encoded, in a #fragment and an attribute → the same fake as the plain address', () => {
    const out = main(
      '<b>lena@corp.io</b><a href="#search/from%3Alena%40corp.io+is%3Aunread">s</a><i data-q="LENA%40CORP.IO">q</i>',
    );
    expect(out.toLowerCase()).not.toContain('corp.io');
    const encoded = plainFake(out).replace('@', '%40');
    expect(out).toContain(`href="#search/from%3A${encoded}+is%3Aunread"`);
    expect(out).toContain(`data-q="${encoded}"`);
  });

  it('inside a base64url id (Google Calendar data-eventid / eid path) → re-encoded with the fake', () => {
    const token = b64url('5pap18padh0q9eg4 lena@corp.io');
    const out = main(
      `<b>lena@corp.io</b><div data-eventid="${token}">e</div><a href="https://cal.example/r/eventedit/${token}">e</a>`,
    );
    expect(out).not.toContain(token);
    const tokens = [...out.matchAll(/(?:data-eventid="|eventedit\/)([A-Za-z0-9_-]+)"/g)].map(
      (m) => m[1] ?? '',
    );
    expect(tokens).toHaveLength(2);
    for (const faked of tokens) expect(decode(faked)).toBe(`5pap18padh0q9eg4 ${plainFake(out)}`);
  });

  it('inside a standard base64 value with "/" and padding → stays standard and padded', () => {
    const token = Buffer.concat([Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from(' ann@corp.io;')]).toString(
      'base64',
    );
    expect(token).toMatch(/\/.*=$/);
    const out = main(`<b>ann@corp.io</b><a href="https://cal.example/r/${token}">e</a>`);
    const faked = /cal\.example\/r\/([A-Za-z0-9+/=]+)"/.exec(out)?.[1] ?? '';
    expect(faked).toMatch(/=$/);
    expect(decode(faked).slice(3)).toBe(` ${plainFake(out)};`);
  });

  it('leaves base64-looking ids without an address alone', () => {
    const body = `<a href="#inbox/FMfcgzQXJWDsKmvBnqzXbLqPZwHjRtKs" data-id="${b64url('thread-f:1789 no address')}">t</a>`;
    expect(main(body)).toBe(body);
  });
});

describe('phone numbers', () => {
  it.each([
    '(415) 555-0132',
    '415-555-0132',
    '415.555.0132',
    '415 555 0132',
    '+1 415 555 0132',
    '+1 (541) 555-0187',
    '+44 20 7946 0958',
    '+91 98765 43210',
    '+33 6 12 34 56 78',
    '+14155550132',
  ])('%s → same format, different digits', (phone) => {
    const out = main(`<p>Call ${phone} today</p>`);
    expect(out).not.toContain(phone);
    const fake = /Call (.+) today/.exec(out)?.[1] ?? '';
    expect(shape(fake)).toBe(shape(phone));
  });

  it.each(['2026-10-01', '10:30', 'v1.2.3', 'ref 1234567890', '12-34-5678', 'UTC+05:30', 'build 2026.09.30'])(
    'leaves %s alone',
    (text) => {
      expect(main(`<p>${text}</p>`)).toBe(`<p>${text}</p>`);
    },
  );
});

describe('payment cards', () => {
  it.each(['4111 1111 1111 1111', '4111-1111-1111-1111', '3782 822463 10005', '6011 0009 9013 9424 123'])(
    '%s → every group replaced, same grouping',
    (card) => {
      const result = sanitizeHtml(page(`<p>Card ${card} on file</p>`), { seed: 'pii', seeds: SEEDS });
      const fake = /Card (.+) on file/.exec(result.html)?.[1] ?? '';
      expect(shape(fake)).toBe(shape(card));
      expect(fake).not.toBe(card);
      expect(result.stats).toMatchObject({ card: 1, phone: 0 });
    },
  );
});

describe('money', () => {
  it.each([
    ['$1,249.99', '$'],
    ['-$12.00', '$'],
    ['US$ 15', 'US$'],
    ['€89,50', '€'],
    ['89,50 €', '€'],
    ['£7', '£'],
    ['USD 4,200.00', 'USD'],
    ['4,200.00 USD', 'USD'],
    ['¥1,000', '¥'],
    ['₹2,500', '₹'],
    ['1.234,56 EUR', 'EUR'],
  ])('%s → a different amount in %s with the same format', (amount, currency) => {
    const out = main(`<p>Total ${amount} due</p>`);
    const fake = /Total (.+) due/.exec(out)?.[1] ?? '';
    expect(fake).not.toBe(amount);
    expect(fake).toContain(currency);
    expect(shape(fake)).toBe(shape(amount));
  });

  it.each(['Room 101', '3 items', 'in 2026', 'USDA approved', '100%'])('leaves %s alone', (text) => {
    expect(main(`<p>${text}</p>`)).toBe(`<p>${text}</p>`);
  });
});

describe('street addresses', () => {
  it.each([
    ['221 Baker Street', 'Street'],
    ['4127 Wexmoor Lane, Apt 9B, Fernhollow, OR 97399', 'Lane'],
    ['1600 Amphitheatre Parkway, Mountain View, CA 94043', 'Parkway'],
    ['12 N Main St.', 'St'],
    ['350 5th Avenue', 'Avenue'],
  ])('%s → a fake address with the same suffix', (address, suffix) => {
    const out = main(`<p>Ship to ${address} please</p>`);
    expect(out).not.toContain(address);
    expect(out).toMatch(new RegExp(`Ship to \\d+ [A-Z][a-z]+ ${suffix}`));
    for (const part of address
      .split(/[ ,]+/)
      .filter((word) => /^[A-Z][a-z]{3,}$/.test(word) && word !== suffix)) {
      expect(out).not.toContain(part);
    }
  });

  it('keeps the unit label and state but replaces the numbers and city', () => {
    const out = main('<p>4127 Wexmoor Lane, Apt 9B, Fernhollow, OR 97399</p>');
    expect(out).toMatch(/^<p>\d{4} [A-Z][a-z]+ Lane, Apt \dB, [A-Z][a-z]+, OR \d{5}<\/p>$/);
    expect(out).not.toMatch(/4127|97399|Fernhollow/);
  });
});

describe('names', () => {
  it('replaces --names whole and token by token, in any case, consistently', () => {
    const out = main('<p>Priya Raman wrote. Thanks PRIYA! cc priya and Dr. Raman.</p>', {
      names: ['Priya Raman'],
    });
    expect(out.toLowerCase()).not.toMatch(/priya|raman/);
    const [first = '', last = ''] = /<p>(\S+) (\S+) wrote/.exec(out)?.slice(1) ?? [];
    expect(out).toContain(`Thanks ${first.toUpperCase()}!`);
    expect(out).toContain(`cc ${first.toLowerCase()} and Dr. ${last}.`);
  });

  it('learns "Name <email>" and "Last, First" <email> and replaces them everywhere', () => {
    const out = main(
      '<p>From: Marcus Lindqvist &lt;marcus@lindqvist.org&gt;</p><p>"Okafor, Daniel" &lt;d@nw.io&gt;</p>' +
        '<p>Later: Marcus Lindqvist said hi. Okafor, Daniel agreed.</p>',
    );
    expect(out).not.toMatch(/Marcus|Lindqvist|Okafor|Daniel/);
  });

  it('learns name/title/aria-label beside an email attribute, and replaces a bare first name inside that element', () => {
    const out = main(
      '<span email="lena@hoffmann.de" name="Lena Hoffmann" aria-label="Lena Hoffmann">Lena</span>' +
        '<div data-email="ola@nord.no" title="Ola Nordmann"><b>Ola</b></div><p>Lena Hoffmann and Ola Nordmann</p>',
    );
    expect(out).not.toMatch(/Lena|Hoffmann|Ola|Nordmann/);
    const doc = dom(page(out));
    const fullFake = doc.querySelector('span[email]')?.getAttribute('name') ?? '';
    expect(doc.querySelector('span[email]')?.textContent).toBe(fullFake.split(' ')[0]);
    expect(doc.querySelector('p')?.textContent).toContain(fullFake);
  });

  it('learns "Name (email)", even with the bracket on the next line (Gmail account button)', () => {
    const out = main(
      '<a aria-label="Google Account: Poojan Patel&#10;(poojan.patel@gmail.com)">a</a><p>Signed in as Poojan Patel</p>',
    );
    expect(out).not.toMatch(/Poojan|Patel|gmail/);
    expect(out).toContain('Google Account: ');
  });

  it('does not learn stopwords, and keeps a single-word sender local', () => {
    const out = main(
      '<p>Support Team &lt;support@acme.io&gt;</p><p>Google &lt;no-reply@google.com&gt;</p><p>Open Google Calendar. Support hours.</p>' +
        '<p>Contact Us (help@acme.io)</p>',
    );
    expect(out).toContain('<p>Contact Us (');
    expect(out).toContain('<p>Support Team &lt;');
    expect(out).toContain('Open Google Calendar. Support hours.');
    expect(out).not.toContain('<p>Google &lt;');
  });

  it('leaves UI text alone when no name was learned', () => {
    const body = '<button aria-label="Mark as read">Mark as read</button><p>Sent an email to the team</p>';
    expect(main(body)).toBe(body);
  });
});

describe('--redact-selector', () => {
  it('replaces matched text and labels with fake phrases, keeps structure, and replaces the same text elsewhere', () => {
    const body =
      '<div class="subj" title="Q3 contract renewal"><b>Q3 contract</b> renewal</div>' +
      '<div class="subj">Lunch</div><p aria-label="Q3 contract renewal">Re: Q3 contract renewal</p>';
    const out = main(body, { redactSelectors: ['.subj'] });
    expect(out).not.toMatch(/Q3|contract|renewal|Lunch/);
    const doc = dom(page(out));
    expect(doc.querySelectorAll('.subj b')).toHaveLength(1);
    const fakeTitle = doc.querySelector('.subj')?.getAttribute('title') ?? '';
    expect(doc.querySelector('p')?.getAttribute('aria-label')).toBe(fakeTitle);
    expect(doc.querySelector('p')?.textContent).toBe(`Re: ${fakeTitle}`);
  });

  it('is deterministic per seed', () => {
    const body = '<div class="subj">Quarterly numbers</div>';
    expect(main(body, { redactSelectors: ['.subj'] })).toBe(main(body, { redactSelectors: ['.subj'] }));
    expect(main(body, { redactSelectors: ['.subj'], seed: 'other' })).not.toBe(
      main(body, { redactSelectors: ['.subj'] }),
    );
  });
});

describe('Faker', () => {
  it('derives every fake from the seed and the original only', () => {
    const a = new Faker('s');
    const b = new Faker('s');
    expect(a.email('x@y.io')).toBe(b.email('x@y.io'));
    expect(a.nameToken('Ann')).toBe(b.nameToken('ann'));
    expect(a.phone('415-555-0132')).toBe(b.phone('415-555-0132'));
    expect(a.amount('$', '12.50')).toBe(b.amount('$', '12.50'));
    expect(new Faker('t').email('x@y.io')).not.toBe(a.email('x@y.io'));
  });

  it('never returns an original or a reserved value, and keeps fakes unique', () => {
    const faker = new Faker('s');
    const reserved = Array.from({ length: 200 }, (_unused, i) => new Faker('r').nameToken(`n${i}`));
    faker.reserve(reserved);
    const fakes = Array.from({ length: 300 }, (_unused, i) => faker.nameToken(`person${i}`));
    expect(new Set(fakes.map((fake) => fake.toLowerCase())).size).toBe(300);
    expect(fakes.some((fake) => reserved.includes(fake))).toBe(false);
    for (const digit of ['0', '1', '5', '9']) expect(faker.amount('$', digit)).not.toBe(digit);
  });

  it('matchCase follows ALL CAPS and all lower', () => {
    expect(matchCase('Avery', 'JOHN')).toBe('AVERY');
    expect(matchCase('Avery', 'john')).toBe('avery');
    expect(matchCase('Avery', 'John')).toBe('Avery');
  });

  it('nameTokens drops initials and stopwords unless asked to keep them', () => {
    expect(nameTokens('J. R. "Bob" Smith')).toEqual(['Bob', 'Smith']);
    expect(nameTokens('Support Team')).toEqual([]);
    expect(nameTokens('Support Team', true)).toEqual(['Support', 'Team']);
  });
});
