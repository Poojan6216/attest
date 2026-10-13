/**
 * Every number in what is posted is the metric it names (./figures.ts; Sprint 7 close, tech review TECH-2, QA review
 * QA-2): each figure a text may print is found there and equals its metrics, and once those are taken out the text
 * prints no other number, in any shape the reader reads (./public-numbers.ts), which is held here to each shape a
 * marketing figure takes.
 */
import { describe, expect, it } from 'vitest';

import { FIGURES, POSTED } from './figures';
import { numbersIn } from './public-numbers';

/** The number `written` stands for: a percentage as its fraction. */
const valueOf = (written: string): number =>
  written.endsWith('%') ? Number(written.slice(0, -1)) / 100 : Number(written.replaceAll(',', ''));

describe('the posted text', () => {
  it.each(Object.keys(POSTED))('%s prints only figures that name their metric, each its value', (text) => {
    let rest = POSTED[text] ?? '';
    for (const figure of FIGURES[text] ?? []) {
      const found = [...rest.matchAll(figure.pattern)];
      expect(found.length, `${text}: ${String(figure.pattern)}`).toBeGreaterThan(0);
      for (const [written, ...numbers] of found) {
        const measured = figure.measured();
        expect(numbers.length, written).toBe(measured.length);
        for (const [index, number] of numbers.entries())
          expect(Math.abs(valueOf(number) - (measured[index] ?? Number.NaN)), written).toBeLessThan(1e-9);
      }
      rest = rest.replace(figure.pattern, ' ');
    }
    expect(numbersIn(rest).map(([written]) => written)).toEqual([]);
  });

  it('names a figure only for a text that is posted', () => {
    for (const text of Object.keys(FIGURES)) expect(Object.keys(POSTED)).toContain(text);
  });
});

describe('the number reader', () => {
  it.each([
    ['It checks 5,000 claims a second.', [5000]],
    ['10x faster than reading it yourself', [10]],
    ['a first paint in 37ms', [37]],
    ['93MB of storage', [93]],
    ['a 37-day window', [37]],
    ['0.9559 of the sentences, 95% of fields', [0.9559, 95]],
    ['Seven in nine sends, six of the thirteen strategies', [7, 9, 6, 13]],
    ['one Mac, the two tests, a third option', []],
    ['1. Show HN: a title draft', []],
    ['Desktop Chrome 122 or later; Q3 deck; §11; v0.2', []],
    ['On Sept 19, and on 2026-10-13', []],
    ['`pnpm e2e` and [a link](docs/a-2.md)', []],
  ])('reads %j as %j', (text, values) => {
    expect(numbersIn(text).map(([, value]) => value)).toEqual(values);
  });
});
