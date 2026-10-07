/**
 * No real capture holds an address, a phone number or a place in a form the sanitiser cannot see (security
 * re-review of the captures of 2026-10-06: the founder's address sat inside Uber's click links, deflated and
 * base64url-encoded; trip addresses sat in Google Maps link paths; a phone number sat in a `tel:` link).
 *
 * Every captured page under tests/fixtures/pages (any vendor folder, labelled or not; hand-written `synthetic-*`
 * pages and the `_harness` inputs of the capture tool's own tests are not captures) is read whole and with `<wbr>`
 * and `\/` removed (Gmail splits long visible addresses with them). Every long token and each of its path segments
 * is read as text, percent-decoded, JavaScript-unescaped, and base64- and base64url-decoded at each of four offsets;
 * every decoded byte string is also inflated (zlib, raw deflate, gzip, truncated input included) and read leniently
 * percent-decoded. Every address found must be a fake (`example.com`, `.org`, `.net`) or a receipt-registry sender,
 * and every short calendar id (`<name>@m`, `<name>@g` inside an event id) must name a fake the page also writes as a
 * fake address. A link to another host keeps no path, and a contact link no number (Hard Rule 2; SEC-R1, R13).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { constants, deflateSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { PAGES_ROOT } from './fixture-labels';

/** Every captured page: `<vendor>/<date>/<name>.html`, not `synthetic-*`, not under a `_` folder. */
function captures(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('_'))
        walk(path.join(dir, entry.name), `${rel}${entry.name}/`);
      else if (entry.isFile() && entry.name.endsWith('.html') && !entry.name.startsWith('synthetic-'))
        out.push(`${rel}${entry.name}`);
    }
  };
  walk(PAGES_ROOT, '');
  return out.sort();
}

const CAPTURES = captures();
/** The host a vendor folder's pages live on (other vendors: none, so every absolute link must be host-only). */
const HOSTS: Readonly<Record<string, string>> = { gmail: 'mail.google.com', gcal: 'calendar.google.com' };

const FAKE_DOMAINS = /^(?:example\.(?:com|org|net))$/iu;
const REGISTRY = [
  'stripe.com',
  'amazon.com',
  'facebookmail.com',
  'opentable.com',
  'instacart.com',
  'uber.com',
  'shopifyemail.com',
];
const ADDRESS = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/gu;
const SHORT_ID = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([mg])(?![A-Za-z0-9.@-])/gu;
const LINK =
  /\s(?:href|xlink:href|action|formaction|cite|data-saferedirecturl|data-url|data-href|data-link)="([^"]*)"/gu;
const TOKEN = /[A-Za-z0-9_\-+/%=\\]{16,}/gu;
const SYNC_FLUSH = { finishFlush: constants.Z_SYNC_FLUSH };

const allowed = (domain: string): boolean =>
  FAKE_DOMAINS.test(domain) ||
  REGISTRY.some((d) => domain.toLowerCase() === d || domain.toLowerCase().endsWith(`.${d}`));

/** zlib's two-byte header: deflate method, and the pair a multiple of 31. */
const isZlib = (b: Buffer): boolean =>
  b.length > 2 && ((b[0] ?? 0) & 0x0f) === 8 && (((b[0] ?? 0) << 8) | (b[1] ?? 0)) % 31 === 0;
const isGzip = (b: Buffer): boolean => b[0] === 0x1f && b[1] === 0x8b;

/**
 * `bytes` as text, and inflated in each format a link may carry: zlib and gzip only when their header is there (a
 * failed attempt costs an exception), raw deflate, which has no header, always; a truncated stream gives what it
 * holds.
 */
function texts(bytes: Buffer): string[] {
  const out = [bytes.toString('latin1')];
  const inflaters = [
    ...(isZlib(bytes) ? [inflateSync] : []),
    ...(isGzip(bytes) ? [gunzipSync] : []),
    inflateRawSync,
  ];
  for (const inflate of inflaters) {
    try {
      out.push(inflate(bytes, SYNC_FLUSH).toString('latin1'));
    } catch {
      // Not that format.
    }
  }
  return out;
}

/** Every reading of `token`: itself, percent-decoded, and base64/base64url-decoded at offsets 0 to 3. */
function readings(token: string): string[] {
  const out = [token];
  try {
    out.push(decodeURIComponent(token));
  } catch {
    // Not percent-encoded.
  }
  for (let offset = 0; offset < 4; offset += 1) {
    const part = token.slice(offset).replace(/%3D/giu, '=');
    for (const alphabet of ['base64', 'base64url'] as const) out.push(...texts(Buffer.from(part, alphabet)));
  }
  return out;
}

/** A reading, leniently percent-decoded and JavaScript-unescaped (`%40`, `\u0040`, `\x40`). */
const decodedForms = (text: string): string[] => [
  text,
  text
    .replace(/%([0-9A-Fa-f]{2})/gu, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u00([0-9A-Fa-f]{2})|\\x([0-9A-Fa-f]{2})/gu, (_, a?: string, b?: string) =>
      String.fromCharCode(parseInt(a ?? b ?? '0', 16)),
    ),
];

/** Every reading of a page: the page, the page without `<wbr>` and `\/`, and every reading of its tokens. */
function pageReadings(html: string): string[] {
  const joined = html.replace(/<wbr\s*\/?>/giu, '').replace(/\\\//gu, '/');
  const tokens = new Set(
    [html, joined].flatMap((text) =>
      (text.match(TOKEN) ?? []).flatMap((token) => [token, ...token.split(/[/\\]/u)]),
    ),
  );
  const out = [html, joined];
  for (const token of tokens) if (token.length >= 16) out.push(...readings(token));
  return out.flatMap(decodedForms);
}

/** What the readings name that is not a fake: real-looking domains, and short ids whose name no fake address has. */
function leaks(html: string): string[] {
  const all = pageReadings(html);
  const fakeLocals = new Set<string>();
  const found = new Set<string>();
  for (const text of all) {
    for (const [, local = '', domain = ''] of text.matchAll(ADDRESS)) {
      if (FAKE_DOMAINS.test(domain)) fakeLocals.add(local.toLowerCase());
      else if (!allowed(domain)) found.add(`address at ${domain.toLowerCase()}`);
    }
  }
  for (const text of all) {
    for (const [, local = '', kind = ''] of text.matchAll(SHORT_ID))
      if (!fakeLocals.has(local.toLowerCase()))
        found.add(`short calendar id @${kind} (${String(local.length)} chars)`);
  }
  return [...found].sort();
}

describe('real captures hide no address, number or place in an encoding (Hard Rule 2)', () => {
  it('there are real captures to check', () => {
    expect(CAPTURES.length).toBeGreaterThan(0);
  });

  it.each(CAPTURES)('%s: every address and short calendar id in every reading is a fake', (file) => {
    // Domains and lengths only: the test never prints an address.
    expect(leaks(readFileSync(path.join(PAGES_ROOT, file), 'utf8'))).toEqual([]);
  });

  it.each(CAPTURES)(
    '%s: a link to another host keeps no path, a contact link no number, no link searches a map',
    (file) => {
      const html = readFileSync(path.join(PAGES_ROOT, file), 'utf8');
      const own = HOSTS[file.split('/')[0] ?? ''] ?? null;
      const offenders: string[] = [];
      for (const [, value = ''] of html.matchAll(LINK)) {
        const absolute = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#\s]*)(.*)$/iu.exec(value);
        if (absolute !== null && absolute[1]?.toLowerCase() !== own && !['', '/'].includes(absolute[2] ?? ''))
          offenders.push(`path to ${absolute[1] ?? ''}`);
        if (/^\s*(?:tel|sms|callto|geo):\s*\S/iu.test(value)) offenders.push('contact or place value');
      }
      if (/maps\/(?:search|place|dir)\//iu.test(html)) offenders.push('maps path');
      expect(offenders).toEqual([]);
    },
  );

  it('the readers find what they look for: each form, planted in a page, is caught', () => {
    const address = 'jane.doe%40corp.io';
    const blob = (text: string) => deflateSync(Buffer.from(text)).toString('base64url');
    const page = (body: string) =>
      `<html><body><span email="avery@example.com">A</span>${body}</body></html>`;
    expect(leaks(page(`<a href="https://t.example/c/${blob(`r=${address}`)}">x</a>`))).toEqual([
      'address at corp.io',
    ]);
    const split = blob(`r=${address}&pad=${'x'.repeat(40)}`);
    expect(leaks(page(`<p>${split.slice(0, 30)}<wbr>${split.slice(30)}</p>`))).toEqual([
      'address at corp.io',
    ]);
    expect(leaks(page('<p>jane\\u0040corp.io</p>'))).toEqual(['address at corp.io']);
    const eid = Buffer.from('evt0042 real.person@m').toString('base64url');
    expect(leaks(page(`<div data-eventid="${eid}">e</div>`))).toEqual(['short calendar id @m (11 chars)']);
    const fakeEid = Buffer.from('evt0042 avery@m').toString('base64url');
    expect(leaks(page(`<div data-eventid="${fakeEid}">e</div>`))).toEqual([]);
  });
});
