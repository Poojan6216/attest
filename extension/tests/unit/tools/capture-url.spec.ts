/**
 * SECURITY-2: tokens in query strings and parameter fragments are removed wherever they sit in a captured page
 * (text, data-* attributes, meta content, relative URLs), not only in href. SECURITY-7: the inert window
 * never runs a script, whatever happy-dom's defaults become.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { closeWindow, createInertWindow, trimUrl } from '../../tools/capture-dom';
import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { stripQueryParts } from '../../tools/capture-url';
import { sanitizeHtml, type SeedSecret } from '../../tools/sanitize';

let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

const page = (body: string, head = ''): string =>
  `<!doctype html><html><head><title>t</title>${head}</head><body><div role="main">${body}</div></body></html>`;

const run = (html: string): string => sanitizeHtml(html, { seed: 'unit', seeds: SEEDS }).html;

describe('stripQueryParts', () => {
  it.each([
    ['https://x.example/reset?token=ABC', 'https://x.example/reset'],
    ['//x.example/p?session=ABC', '//x.example/p'],
    ['/relative/path?session=ABC', '/relative/path'],
    ['share?token=ABC', 'share'],
    ['?session=ABC', ''],
    ['https://x.example?code=ABC', 'https://x.example'],
    ['https%3A%2F%2Fx.example%2Fr%3Ftoken%3DABC', 'https%3A%2F%2Fx.example%2Fr'],
    ['#access_token=ABC&state=1', ''],
    ['https://x.example/cb#id_token=ABC', 'https://x.example/cb'],
    ['#inbox?compose=ABC', '#inbox'],
    ['Reset link: https://x.example/r?t=ABC now', 'Reset link: https://x.example/r now'],
  ])('%s → %s', (input, output) => {
    expect(stripQueryParts(input).text).toBe(output);
  });

  it.each(['#inbox', '#fff', 'Ready? Yes.', 'and/or?', 'https://x.example/a/b#section-2', 'a = b & c'])(
    'leaves %s alone',
    (input) => {
      expect(stripQueryParts(input)).toEqual({ text: input, removed: 0 });
    },
  );

  it('trimUrl drops userinfo, the query and parameter fragments, and keeps a plain fragment', () => {
    expect(trimUrl('https://u:p@x.example/p?q=1#frag')).toBe('https://x.example/p#frag');
    expect(trimUrl('https://x.example/cb#access_token=ABC')).toBe('https://x.example/cb');
  });
});

describe('sanitizeHtml removes tokens wherever they sit (SECURITY-2)', () => {
  const html = page(
    [
      '<a href="https://x.example/r?t=HREFTOKEN222">link</a>',
      '<a href="https://www.google.com/url?q=https://x.example/r?token%3DSAFEREDIR333&usg=USGSIG444" data-saferedirecturl="https://www.google.com/url?q=https://x.example/r?token%3DSAFEREDIR333&amp;usg=USGSIG444">r</a>',
      '<div data-url="https://x.example/doc?key=DATAURL555">d</div>',
      '<div data-href="/relative/path?session=RELSESS222">d</div>',
      '<div data-link="//cdn.example/p?sig=DATALINK888">d</div>',
      '<div data-state="?session=BARESESS999">d</div>',
      '<div data-target="https%3A%2F%2Fx.example%2Fr%3Ftoken%3DPCTTOKEN121">d</div>',
      '<p>Your reset link: https://x.example/reset?token=TEXTTOKEN666 expires soon</p>',
      '<a href="https://x.example/cb#access_token=FRAGTOKEN777&amp;state=1">cb</a>',
      '<a href="#inbox?compose=COMPOSE313">compose</a>',
    ].join(''),
    '<meta property="og:url" content="https://x.example/p?reset=RESETTOKEN111">',
  );

  it.each([
    'RESETTOKEN111',
    'HREFTOKEN222',
    'RELSESS222',
    'SAFEREDIR333',
    'USGSIG444',
    'DATAURL555',
    'TEXTTOKEN666',
    'FRAGTOKEN777',
    'DATALINK888',
    'BARESESS999',
    'PCTTOKEN121',
    'COMPOSE313',
  ])('%s does not survive', (token) => {
    expect(run(html)).not.toContain(token);
  });

  it('keeps the relative paths and plain fragments adapters anchor on; another site keeps only its host', () => {
    const out = run(html);
    expect(out).toContain('data-href="/relative/path"');
    expect(out).toContain('href="#inbox"');
    // Another site's address, written as text, loses its path too (security re-review, SEC-R12).
    expect(out).toContain('Your reset link: https://x.example/ expires soon');
  });

  it('counts what it removed: 10 addresses trimmed (8 link attributes, og:url, the text), 2 bare queries', () => {
    const { stats } = sanitizeHtml(html, { seed: 'unit', seeds: SEEDS });
    expect(stats.trimmedUrls).toBe(10);
    // og:url and the text address now lose their query with their path; the two left are not addresses.
    expect(stats.query).toBe(2);
  });
});

describe('the inert window (SECURITY-7)', () => {
  it('never runs a script, inline or appended', async () => {
    const window = createInertWindow();
    try {
      const doc = window.document;
      doc.write('<script>globalThis.__attestRan = "write";</script>');
      const script = doc.createElement('script');
      script.textContent = 'globalThis.__attestRan = "append";';
      doc.body.appendChild(script);
      await window.happyDOM.waitUntilComplete();
      expect(Reflect.get(window, '__attestRan')).toBeUndefined();
      expect(Reflect.get(globalThis, '__attestRan')).toBeUndefined();
      expect(window.happyDOM.settings.enableJavaScriptEvaluation).toBe(false);
    } finally {
      closeWindow(window);
    }
  });
});

describe('committed fixtures carry no token query (SECURITY-2)', () => {
  const PAGES = path.resolve(import.meta.dirname, '../../fixtures/pages');
  const TOKEN_PARAM =
    /[?&#;](?:access_token|id_token|token|session|sessionid|sid|sig|signature|usg|ust|key|code|auth|authuser)=/i;

  function captured(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '_harness' ? [] : captured(full);
      return entry.name.endsWith('.html') ? [full] : [];
    });
  }

  it('no captured vendor fixture has a token-like query or fragment parameter', () => {
    for (const file of captured(PAGES)) {
      expect(readFileSync(file, 'utf8'), path.relative(PAGES, file)).not.toMatch(TOKEN_PARAM);
    }
  });
});
