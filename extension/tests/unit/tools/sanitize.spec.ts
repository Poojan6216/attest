import { type Document, Window } from 'happy-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { CaptureError } from '../../tools/capture-error';
import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { findForeignAts } from '../../tools/capture-pii';
import {
  assertSelectorsValid,
  pickSeeds,
  sanitizeHtml,
  type SanitizeOptions,
  type SeedSecret,
} from '../../tools/sanitize';

const HOST = 'res.evil.example';
let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

function page(body: string, head = ''): string {
  return `<!doctype html><html><head><title>t</title>${head}</head><body><div role="main">${body}</div></body></html>`;
}

function run(html: string, options: Partial<SanitizeOptions> = {}): string {
  return sanitizeHtml(html, { seed: 'unit', seeds: SEEDS, ...options }).html;
}

function dom(html: string): Document {
  const window = new Window({
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
    },
  });
  return new window.DOMParser().parseFromString(html, 'text/html');
}

function attributeNames(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('*')).flatMap((element) => element.getAttributeNames());
}

describe('sanitizeHtml strips what executes', () => {
  it.each([
    ['inline script', page('<script>window.leak = 1</script>'), 'script', 'window.leak'],
    ['external script', page('', `<script src="https://${HOST}/a.js"></script>`), 'script', HOST],
    [
      'svg script',
      page('<svg><script>window.leak = 1</script><circle r="1"/></svg>'),
      'script',
      'window.leak',
    ],
    ['noscript', page(`<noscript><img src="https://${HOST}/n.gif"></noscript>`), 'noscript', HOST],
    ['iframe', page(`<iframe src="https://${HOST}/f" srcdoc="<b>x</b>"></iframe>`), 'iframe', HOST],
    [
      'object',
      page(`<object data="https://${HOST}/o.swf"><param name="m" value="v"></object>`),
      'object',
      HOST,
    ],
    ['embed', page(`<embed src="https://${HOST}/e.swf">`), 'embed', HOST],
    ['base', page('', `<base href="https://${HOST}/">`), 'base', HOST],
    [
      'meta refresh',
      page('', `<meta http-equiv="refresh" content="0;url=https://${HOST}/">`),
      'meta[http-equiv]',
      HOST,
    ],
    ['template', page('<template><p>secret@acme.io</p></template>'), 'template', 'acme.io'],
    ['comment', page('<!-- owner: secret@acme.io -->'), 'nothing', 'acme.io'],
    ...[
      'preload',
      'modulepreload',
      'prefetch',
      'preconnect',
      'dns-prefetch',
      'stylesheet',
      'icon',
      'manifest',
    ].map((rel): [string, string, string, string] => [
      `link rel=${rel}`,
      page('', `<link rel="${rel}" href="https://${HOST}/${rel}">`),
      'link',
      HOST,
    ]),
  ])('removes %s', (_label, html, selector, forbidden) => {
    const out = run(html);
    if (selector !== 'nothing') expect(dom(out).querySelectorAll(selector)).toHaveLength(0);
    expect(out).not.toContain(forbidden);
    expect(out).not.toContain('<!--');
  });
});

describe('sanitizeHtml strips frames, event handlers and script URLs', () => {
  it('removes a frameset and its frames', () => {
    const out = run(
      `<!doctype html><html><head></head><frameset><frame src="https://${HOST}/f"></frameset></html>`,
    );
    expect(out).not.toMatch(/<frame/i);
    expect(out).not.toContain(HOST);
  });

  it.each([
    ['onclick', '<button onclick="steal()">b</button>'],
    ['onerror', '<img onerror="steal()" alt="x">'],
    ['upper-case handler', '<div ONMOUSEOVER="steal()">d</div>'],
    ['svg onload', '<svg onload="steal()"><rect/></svg>'],
    ['framework @binding', '<button @click="steal()">b</button>'],
  ])('removes %s attributes', (_label, body) => {
    const out = run(page(body));
    expect(out).not.toContain('steal()');
    expect(attributeNames(dom(out)).filter((name) => /^on|@/i.test(name))).toEqual([]);
  });

  it('removes body onload', () => {
    const out = run('<!doctype html><html><head></head><body onload="steal()"><main>m</main></body></html>');
    expect(out).not.toContain('steal()');
  });

  it.each([
    ['href', '<a href="javascript:steal()">a</a>'],
    ['mixed case and spaces', '<a href="  JaVaScRiPt:steal()">a</a>'],
    ['tab inside the scheme', '<a href="java&#x09;script:steal()">a</a>'],
    ['vbscript', '<a href="vbscript:steal()">a</a>'],
    ['data:text/html', '<a href="data:text/html,<script>steal()</script>">a</a>'],
    ['formaction', '<form><button formaction="javascript:steal()">b</button></form>'],
    ['svg xlink:href', '<svg><a xlink:href="javascript:steal()"><text>t</text></a></svg>'],
  ])('removes javascript-style URLs: %s', (_label, body) => {
    expect(run(page(body))).not.toContain('steal()');
  });
});

describe('sanitizeHtml neutralises every external resource', () => {
  it.each([
    ['img src', `<img src="https://${HOST}/a.png" alt="a">`],
    ['img srcset', `<img srcset="https://${HOST}/a.png 1x, https://${HOST}/a2.png 2x" alt="a">`],
    ['picture source srcset', `<picture><source srcset="https://${HOST}/p.webp"><img alt="p"></picture>`],
    ['video src and poster', `<video src="https://${HOST}/v.mp4" poster="https://${HOST}/v.png"></video>`],
    ['audio and source src', `<audio><source src="https://${HOST}/a.mp3"></audio>`],
    ['track src', `<video><track src="https://${HOST}/t.vtt"></video>`],
    ['input type=image', `<input type="image" src="https://${HOST}/i.png" alt="i">`],
    ['background attribute', `<table background="https://${HOST}/bg.png"><tr><td>c</td></tr></table>`],
    ['style attribute url()', `<div style="background-image: url('https://${HOST}/s.png')">d</div>`],
    ['svg image href', `<svg><image href="https://${HOST}/i.png"/></svg>`],
    ['svg image xlink:href', `<svg><image xlink:href="https://${HOST}/i.png"/></svg>`],
    ['svg use external href', `<svg><use href="https://${HOST}/sprite.svg#a"/></svg>`],
    ['a ping', `<a href="#x" ping="https://${HOST}/ping">a</a>`],
    ['a attributionsrc', `<a href="#x" attributionsrc="https://${HOST}/attr">a</a>`],
    ['style attribute escaped url()', `<div style="background: \\75 rl(https://${HOST}/e.png)">d</div>`],
    // SVG presentation attributes: Chromium fetches each of these (fill/mask/clip-path/marker/cursor).
    ...['fill', 'stroke', 'mask', 'clip-path', 'filter', 'marker-end', 'cursor'].map(
      (name): [string, string] => [
        `svg ${name}="url(…)"`,
        `<svg><rect ${name}="url(https://${HOST}/r.svg#a)"/></svg>`,
      ],
    ),
  ])('%s', (_label, body) => {
    expect(run(page(body))).not.toContain(HOST);
  });

  it.each([
    ['style block url()', `<style>.a { background: url(https://${HOST}/b.png) }</style>`],
    ['@import', `<style>@import url("https://${HOST}/i.css");</style>`],
    ['@font-face', `<style>@font-face { font-family: X; src: url(https://${HOST}/x.woff2) }</style>`],
    ['html manifest', ''],
  ])('%s in the head', (label, head) => {
    const html =
      label === 'html manifest'
        ? `<!doctype html><html manifest="https://${HOST}/app.appcache"><head></head><body><main>m</main></body></html>`
        : page('', head);
    expect(run(html)).not.toContain(HOST);
  });
});

describe('sanitizeHtml keeps the page itself and drops what points elsewhere', () => {
  it('keeps same-document references: svg <use href="#id"> and url(#id)', () => {
    const out = run(
      page(
        '<svg><defs><path id="i"/></defs><use href="#i"/><rect style="mask: url(#i)" fill="url(#i)"/></svg>',
      ),
    );
    expect(out).toContain('<use href="#i">');
    expect(out).toContain('style="mask: url(#i)" fill="url(#i)"');
  });

  it('drops session secrets: hidden-input values, nonces, csrf meta; keeps visible input values', () => {
    const out = run(
      page(
        '<form><input type="hidden" name="at" value="AF6bupTok3n"><input type="text" value="Search mail">' +
          '<input type="password" value="Pa55w0rdVal"></form>' +
          '<style nonce="N0nc3v4lue">p { color: red }</style>',
        '<meta name="csrf-token" content="Csrf5ecret"><meta name="viewport" content="width=device-width">',
      ),
    );
    expect(out).not.toMatch(/AF6bupTok3n|Pa55w0rdVal|N0nc3v4lue|Csrf5ecret|nonce=/);
    const doc = dom(out);
    expect(doc.querySelector('input[name="at"]')?.hasAttribute('value')).toBe(false);
    expect(doc.querySelector('input[type="text"]')?.getAttribute('value')).toBe('Search mail');
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
  });

  it("trims query strings and userinfo from the page's own links, keeps the path and fragment", () => {
    const out = run(
      page(
        `<a href="https://user:pw@${HOST}/mail/u/0/?ik=abc123&tok=zz#inbox/123">a</a>` +
          `<svg><a xlink:href="https://${HOST}/s?tok=zz"><text>t</text></a></svg>`,
      ),
      { pageUrl: `https://${HOST}/mail/u/0/` },
    );
    expect(out).toContain(`href="https://${HOST}/mail/u/0/#inbox/123"`);
    expect(out).toContain(`xlink:href="https://${HOST}/s"`);
    expect(out).not.toMatch(/abc123|user:pw|tok=/);
  });
});

describe('sanitizeHtml keeps what adapters anchor on', () => {
  it('keeps role, aria-*, data-*, id, class, tabindex and the element tree', () => {
    const body =
      '<table role="grid" aria-label="Sent messages" id="grid"><tbody>' +
      '<tr role="row" class="zA x1" data-thread-id="t-1" aria-selected="false" tabindex="-1"><td role="gridcell">a</td></tr>' +
      '<tr role="row" class="zA" data-thread-id="t-2" aria-selected="true" tabindex="-1"><td role="gridcell">b</td></tr>' +
      '</tbody></table>';
    const before = dom(page(body));
    const after = dom(run(page(body)));
    expect(after.querySelectorAll('[role="row"]')).toHaveLength(2);
    expect(after.querySelector('#grid')?.getAttribute('aria-label')).toBe('Sent messages');
    expect(after.querySelector('[data-thread-id="t-2"]')?.getAttribute('aria-selected')).toBe('true');
    expect(after.querySelector('tr.zA.x1')?.getAttribute('tabindex')).toBe('-1');
    expect(after.querySelectorAll('table *').length).toBe(before.querySelectorAll('table *').length);
  });

  it('writes a standalone document: doctype, then meta charset first in head', () => {
    const out = run('<html><head><meta charset="windows-1252"><title>t</title></head><body>b</body></html>');
    expect(out.startsWith('<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>')).toBe(true);
    expect(out.match(/<meta charset/g)).toHaveLength(1);
  });

  it('keeps everything after an inline svg with a <style> (happy-dom parser guard)', () => {
    const out = run(page('<svg><style>.i{fill:red}</style><path d="M0"/></svg><p id="after">after</p>'));
    expect(dom(out).querySelector('#after')?.textContent).toBe('after');
  });
});

describe('sanitizeHtml injects seeded secrets', () => {
  function seeded(html: string, seed = 'unit'): { ids: string[]; values: string[]; parents: string[] } {
    const result = sanitizeHtml(html, { seed, seeds: SEEDS });
    const elements = Array.from(dom(result.html).querySelectorAll('[data-attest-seeded]'));
    expect(elements.map((element) => element.getAttribute('data-attest-seeded'))).toEqual(
      result.seededSecrets,
    );
    return {
      ids: [...result.seededSecrets],
      values: elements.map((element) => element.textContent),
      parents: elements.map(
        (element) => element.parentElement?.getAttribute('role') ?? element.parentElement?.localName ?? '',
      ),
    };
  }

  it('puts exactly three visible seed values into [role=main]', () => {
    const { ids, values, parents } = seeded(page('<p>content</p>'));
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(values).toEqual(ids.map((id) => SEEDS.find((seed) => seed.id === id)?.value));
    expect(parents).toEqual(['main', 'main', 'main']);
    const out = run(page('<p>content</p>'));
    for (const element of Array.from(dom(out).querySelectorAll('[data-attest-seeded]'))) {
      expect(element.hasAttribute('hidden')).toBe(false);
      expect(element.getAttribute('style')).toContain('display: block');
    }
  });

  it('falls back to <main>, then <body>', () => {
    expect(seeded('<html><body><main><p>m</p></main></body></html>').parents).toEqual([
      'main',
      'main',
      'main',
    ]);
    expect(seeded('<html><body><p>b</p></body></html>').parents).toEqual(['body', 'body', 'body']);
  });

  it('chooses the same three for the same seed, and different ones across seeds', () => {
    expect(seeded(page('x'), 'alpha').ids).toEqual(seeded(page('x'), 'alpha').ids);
    const choices = new Set(
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((seed) =>
        pickSeeds(SEEDS, seed)
          .map((s) => s.id)
          .join(),
      ),
    );
    expect(choices.size).toBeGreaterThan(1);
  });

  it('never injects a seed containing "@", and refuses with fewer than three eligible seeds', () => {
    const withAt = [{ id: 'mail', value: 'x@corp.io', canaries: [] }, ...SEEDS];
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(pickSeeds(withAt, seed).map((s) => s.id)).not.toContain('mail');
    }
    const few = SEEDS.slice(0, 2).concat([{ id: 'mail', value: 'x@corp.io', canaries: [] }]);
    expect(() => pickSeeds(few, 'a')).toThrow(expect.objectContaining({ code: 'too_few_seeds' }));
  });
});

describe('sanitizeHtml determinism', () => {
  const html = page(
    '<span email="ann.lee@acme.io" name="Ann Lee">Ann Lee</span><p>Paid $12.50 to Ann Lee &lt;ann.lee@acme.io&gt;, call (415) 555-0132.</p>',
  );

  it('same input and seed give byte-identical output', () => {
    expect(run(html, { seed: 's1' })).toBe(run(html, { seed: 's1' }));
  });

  it('a different seed gives different fakes over the same structure', () => {
    const one = run(html, { seed: 's1' });
    const two = run(html, { seed: 's2' });
    expect(one).not.toBe(two);
    expect(dom(one).querySelectorAll('*').length).toBe(dom(two).querySelectorAll('*').length);
    const emailOf = (out: string): string | null =>
      dom(out).querySelector('span[email]')?.getAttribute('email') ?? null;
    expect(emailOf(one)).not.toBe(emailOf(two));
  });
});

describe('sanitizeHtml errors', () => {
  it('rejects an invalid --redact-selector with a typed error', () => {
    expect(() => run(page('x'), { redactSelectors: ['div['] })).toThrow(CaptureError);
    expect(() => {
      assertSelectorsValid(['div > span', '[data-x]']);
    }).not.toThrow();
    expect(() => {
      assertSelectorsValid(['div > span', ':::']);
    }).toThrow(expect.objectContaining({ code: 'bad_selector' }));
  });
});

describe('the "@" check', () => {
  it('finds no "@" outside example.com/org/net in a sanitised kitchen-sink page', () => {
    const head =
      `<style>@media (max-width: 1px) { a { color: red } } .md\\@flex { display: flex } a::after { content: "@x" }</style>` +
      `<title>Inbox - me@corp.io</title>`;
    const body =
      '<p>Follow @northwind, write to a.b@corp.io or "Ann Lee" &lt;ann@lee.family&gt;; see https://maps.example/@40.7,-74</p>' +
      `<img srcset="https://${HOST}/b@2x.png 2x" alt="x"><a href="mailto:x@y.co?cc=z@w.org">m</a>` +
      '<div data-owner="owner@corp.io" class="@container" title="user@host">t</div>' +
      '<p>Ping me@localhost or @ alone, or sales@corp.example.com.evil.io</p>';
    const out = run(page(body, head), { names: ['Ann Lee'] });
    expect(findForeignAts(out)).toEqual([]);
    for (const match of out.matchAll(/@/g)) {
      expect(out.slice(match.index, match.index + 12)).toMatch(/^@example\.(?:com|org|net)$/);
    }
    expect(out).toContain('@example.');
  });
});
