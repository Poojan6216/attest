import { describe, expect, it } from 'vitest';

import { neutraliseCssUrls, sanitizeCss, stripCommentsAndAtRules } from '../../tools/capture-css';
import { stripForeignRawText } from '../../tools/capture-html-guard';

const HOST = 'res.evil.example';

describe('sanitizeCss', () => {
  it.each([
    ['@import url()', `@import url("https://${HOST}/a.css"); a { color: red }`],
    ['@import string', `@import 'https://${HOST}/b.css' screen; a { color: red }`],
    [
      '@font-face src',
      `@font-face { font-family: X; src: url(https://${HOST}/x.woff2) format('woff2') } a { color: red }`,
    ],
    ['url() double-quoted', `a { background: url("https://${HOST}/c.png") }`],
    ['url() single-quoted', `a { background-image: url('https://${HOST}/d.png') }`],
    ['url() bare', `a { list-style: url(https://${HOST}/e.png) }`],
    ['url() relative', `a { cursor: url(/${HOST}/f.cur), auto }`],
    ['url() upper-case', `a { background: URL(https://${HOST}/g.png) }`],
    [
      'image-set()',
      `a { background-image: image-set("https://${HOST}/h.png" 1x, "https://${HOST}/i.png" 2x) }`,
    ],
    ['-webkit-image-set()', `a { background-image: -webkit-image-set(url(https://${HOST}/j.png) 1x) }`],
    // Chromium decodes an escaped function name and fetches it (verified against Playwright's Chromium).
    ['url() with a hex-escaped name', `a { background: \\75 rl(https://${HOST}/n.png) }`],
    ['url() with a char-escaped name', `a { background: u\\rl("https://${HOST}/o.png") }`],
    ['image-set() with an escaped name', `a { background: \\69 mage-set("https://${HOST}/p.png" 1x) }`],
    [
      '@media block',
      `@media (min-width: 1px) { a { background: url(https://${HOST}/k.png) } } b { color: red }`,
    ],
    [
      'nested @supports',
      `@supports (display: grid) { @media screen { a { background: url(https://${HOST}/l.png) } } }`,
    ],
  ])('neutralises %s', (_label, css) => {
    const result = sanitizeCss(css);
    expect(result.css).not.toContain(HOST);
    expect(result.css).not.toContain('@');
    expect(result.atRulesRemoved + result.urlsNeutralised).toBeGreaterThan(0);
  });

  it('drops comments, which can carry anything', () => {
    expect(sanitizeCss(`/* https://${HOST}/m.png me@${HOST} */ a { color: red }`).css).toBe(
      ' a { color: red }',
    );
  });

  it('keeps ordinary rules, fragment url(#id), and @ inside strings and escapes', () => {
    const css =
      'a::after { content: "@x" } .md\\@flex { display: flex } .m { mask: url(#clip) } b { color: red } ' +
      '.w-\\[calc\\(100\\%-2rem\\)\\]:not(.x) { width: calc(100% - 2rem); transform: translate(1px, 2px) }';
    const result = sanitizeCss(css);
    expect(result.css).toBe(css);
    expect(result.atRulesRemoved).toBe(0);
    expect(result.urlsNeutralised).toBe(0);
  });

  it('neutraliseCssUrls (SVG presentation attributes) touches only resource functions', () => {
    expect(neutraliseCssUrls(`url(https://${HOST}/p.svg#a)`)).toEqual({ css: 'none', count: 1 });
    expect(neutraliseCssUrls(`url(https://${HOST}/c.png), auto`)).toEqual({ css: 'none, auto', count: 1 });
    expect(neutraliseCssUrls('url(#grad)')).toEqual({ css: 'url(#grad)', count: 0 });
    expect(neutraliseCssUrls('translate(4 5) rotate(90)')).toEqual({
      css: 'translate(4 5) rotate(90)',
      count: 0,
    });
  });

  it('replaces external url() with none so the declaration stays valid', () => {
    expect(sanitizeCss(`a { background: #fff url('https://${HOST}/x.png') no-repeat }`).css).toBe(
      'a { background: #fff none no-repeat }',
    );
  });

  it('drops an at-rule statement left unterminated by its block without eating the closing brace', () => {
    const { css, removed } = stripCommentsAndAtRules('@media x { @charset "y" } a { color: red }');
    expect(removed).toBe(1);
    expect(css).toBe(' a { color: red }');
  });

  it('handles unterminated input without looping or throwing', () => {
    expect(sanitizeCss('a { background: url("https://x.example/a.png').css).not.toContain('x.example/a.png"');
    expect(stripCommentsAndAtRules('@media (x) { a { color: red }').css).toBe('');
    expect(stripCommentsAndAtRules('a { color: red } /* open').css).toBe('a { color: red } ');
  });
});

describe('stripForeignRawText (happy-dom svg/math raw-text guard)', () => {
  it.each([
    ['svg style', '<svg><style>.a{fill:red}</style><path d="M0"/></svg><p>after</p>'],
    ['svg script', '<svg><script>x = 1</script></svg><p>after</p>'],
    ['self-closing svg style', '<svg><style/><path/></svg><p>after</p>'],
    ['math style', '<math><style>x{}</style><mi>x</mi></math><p>after</p>'],
    ['nested svg', '<svg><svg><path/></svg><style>.b{}</style></svg><p>after</p>'],
  ])('removes %s and keeps what follows', (_label, html) => {
    const result = stripForeignRawText(html);
    expect(result.removed).toBe(1);
    expect(result.html).not.toMatch(/<style|<script/i);
    expect(result.html).toContain('<p>after</p>');
  });

  it('leaves HTML style/script alone and ignores markup-looking text inside raw text and comments', () => {
    const html =
      '<style>a::after{content:"<svg><style>"}</style><script>var s = "<svg><style>";</script>' +
      '<!-- <svg><style> --><title><svg></title><p>after</p>';
    expect(stripForeignRawText(html)).toEqual({ html, removed: 0 });
  });

  it('handles an unclosed foreign style by cutting to the end (nothing to keep after it)', () => {
    expect(stripForeignRawText('<p>before</p><svg><style>.a{}')).toEqual({
      html: '<p>before</p><svg>',
      removed: 1,
    });
  });
});
