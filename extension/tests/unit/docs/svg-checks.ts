/**
 * The checks every diagram in docs/assets holds to (agents/docs_writer.md rule 5: SVG in the repo, legible in dark
 * mode, no external renderer), shared by each diagram's own spec. Legibility does not rest on a media query (which
 * follows the operating system, not the page): the background is transparent and every colour must hold 4:1 contrast
 * against both a white page and GitHub's dark page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './worked-examples-check';

export const BACKGROUNDS = ['#ffffff', '#0d1117'];
export const MIN_CONTRAST = 4;

/** WCAG 2 relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Problems with the nesting of element tags in SVG text without comments; [] when every tag closes in order. */
export function nestingProblems(svg: string): string[] {
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

/** The diagram `file` of docs/assets, and what renders of it: the file without its comments. */
export function readDiagram(file: string): { readonly svg: string; readonly body: string } {
  const svg = readFileSync(path.join(REPO_ROOT, 'docs', 'assets', file), 'utf8');
  return { svg, body: svg.replace(/<!--[\s\S]*?-->/g, '') };
}

/** Registers the structure and legibility checks for the diagram `file` of docs/assets. */
export function describeDiagram(file: string): void {
  const { svg, body } = readDiagram(file);

  describe(`docs/assets/${file}: structure`, () => {
    it('is a well-formed, labelled SVG image', () => {
      expect(svg.trimStart().startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
      expect(svg).toContain('role="img"');
      expect(svg).toMatch(/<title id="title">[^<]+<\/title>/);
      expect(svg).toMatch(/<desc id="desc">[^<]+<\/desc>/);
      expect(nestingProblems(body)).toEqual([]);
    });

    it('loads nothing: no script, no external link, image, font or stylesheet', () => {
      const urls = [...body.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]);
      expect(urls).toEqual(['http://www.w3.org/2000/svg']);
      expect(body).not.toMatch(/<script|<image|<foreignObject|@import|@font-face|href=/i);
      for (const ref of body.matchAll(/url\(([^)]*)\)/g)) expect(ref[1]).toMatch(/^#[\w-]+$/);
    });
  });

  describe(`docs/assets/${file}: legible on light and dark pages`, () => {
    it('has a transparent background and no theme media query', () => {
      expect(body).not.toMatch(/prefers-color-scheme|background/);
      const widths = [...body.matchAll(/<rect[^>]*\swidth="(\d+)"/g)].map((m) => Number(m[1]));
      const viewWidth = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1]);
      expect(widths.length).toBeGreaterThan(0);
      for (const width of widths) expect(width).toBeLessThan(viewWidth);
    });

    it(`uses only colours with ≥ ${String(MIN_CONTRAST)}:1 contrast on white and on GitHub dark`, () => {
      const colours = [...new Set([...body.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
      expect(colours.length).toBeGreaterThan(0);
      for (const colour of colours) {
        for (const background of BACKGROUNDS) {
          expect(contrast(colour, background), `${colour} on ${background}`).toBeGreaterThanOrEqual(
            MIN_CONTRAST,
          );
        }
      }
      expect(body).not.toMatch(/#[0-9a-fA-F]{3}\b|rgb\(|hsl\(|currentColor/);
      expect(contrast('#1f2328', '#0d1117')).toBeLessThan(MIN_CONTRAST);
    });
  });
}
