/**
 * docs/assets/receipt-states.svg, the §8 state-machine diagram (task 1.11; agents/docs_writer.md rule 5: SVG in
 * the repo, legible in dark mode, no external renderer). Legibility does not rest on a media query (which follows
 * the operating system, not the page): the background is transparent and every colour must hold 4:1 contrast
 * against both a white page and GitHub's dark page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './worked-examples-check';

const SVG_FILE = path.join(REPO_ROOT, 'docs', 'assets', 'receipt-states.svg');
const SVG = readFileSync(SVG_FILE, 'utf8');
/** What renders: the file without its comments. */
const BODY = SVG.replace(/<!--[\s\S]*?-->/g, '');
const DOC = readFileSync(path.join(REPO_ROOT, 'docs', 'grading.md'), 'utf8');
const BACKGROUNDS = ['#ffffff', '#0d1117'];
const MIN_CONTRAST = 4;

/** WCAG 2 relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Problems with the nesting of element tags in SVG text without comments; [] when every tag closes in order. */
function nestingProblems(svg: string): string[] {
  const stack: string[] = [];
  const problems: string[] = [];
  for (const match of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing = '', name = '', selfClosing = ''] = match;
    if (selfClosing === '/') continue;
    if (closing === '') stack.push(name);
    else if (stack.pop() !== name) problems.push(`</${name}> closes the wrong element`);
  }
  return [...problems, ...stack.map((name) => `<${name}> never closes`)];
}

describe('docs/assets/receipt-states.svg: structure', () => {
  it('is a well-formed, labelled SVG image', () => {
    expect(SVG.trimStart().startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(SVG).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(SVG).toContain('role="img"');
    expect(SVG).toMatch(/<title id="title">[^<]+<\/title>/);
    expect(SVG).toMatch(/<desc id="desc">[^<]+<\/desc>/);
    expect(nestingProblems(BODY)).toEqual([]);
  });

  it('the nesting check catches an unclosed element', () => {
    expect(nestingProblems('<svg><g><text>x</g></svg>')).toEqual([
      '</g> closes the wrong element',
      '</svg> closes the wrong element',
      '<svg> never closes',
    ]);
  });

  it('loads nothing: no script, no external link, image, font or stylesheet', () => {
    const urls = [...BODY.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]);
    expect(urls).toEqual(['http://www.w3.org/2000/svg']);
    expect(BODY).not.toMatch(/<script|<image|<foreignObject|@import|@font-face|href=/i);
    for (const ref of BODY.matchAll(/url\(([^)]*)\)/g)) expect(ref[1]).toMatch(/^#[\w-]+$/);
  });
});

describe('docs/assets/receipt-states.svg: legible on light and dark pages', () => {
  it('has a transparent background and no theme media query', () => {
    expect(BODY).not.toMatch(/prefers-color-scheme|background/);
    const widths = [...BODY.matchAll(/<rect[^>]*\swidth="(\d+)"/g)].map((m) => Number(m[1]));
    const viewWidth = Number(/viewBox="0 0 (\d+) /.exec(SVG)?.[1]);
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBeLessThan(viewWidth);
  });

  it(`uses only colours with ≥ ${String(MIN_CONTRAST)}:1 contrast on white and on GitHub dark`, () => {
    const colours = [...new Set([...BODY.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) {
      for (const background of BACKGROUNDS) {
        expect(contrast(colour, background), `${colour} on ${background}`).toBeGreaterThanOrEqual(
          MIN_CONTRAST,
        );
      }
    }
    expect(BODY).not.toMatch(/#[0-9a-fA-F]{3}\b|rgb\(|hsl\(|currentColor/);
    expect(contrast('#1f2328', '#0d1117')).toBeLessThan(MIN_CONTRAST);
  });
});

describe('docs/assets/receipt-states.svg: content', () => {
  it('shows every state and every event of §8', () => {
    for (const label of ['PENDING', 'FINAL', 'USER_OVERRIDDEN', 'superseded']) {
      expect(SVG).toMatch(new RegExp(`>${label}</text>`));
    }
    for (const event of ['regrade', 'override', 'revert(at)', 'supersede(claimId)', 'grade()']) {
      expect(SVG).toContain(`>${event}</text>`);
    }
    expect(SVG).toContain('IllegalTransitionError');
    expect(SVG).toContain('previousState');
  });

  it('is embedded in §8 of docs/grading.md', () => {
    const section8 = DOC.slice(DOC.indexOf('\n## 8. '), DOC.indexOf('\n## 9. '));
    expect(section8).toMatch(/!\[[^\]]+\]\(assets\/receipt-states\.svg\)/);
  });
});
