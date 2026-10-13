/**
 * README.md (sprint_7 7.1; agents/docs_writer.md): a reader who reads only its first screen knows what Attest cannot do
 * and where the attacks that still work are; its sections come in the docs writer's order; it uses none of the words
 * the docs writer never writes; and every number in its opening, its Results and its Attacks that still work is one
 * RESULTS.md holds (Sprint 7's rule: every number in public traces to RESULTS.md), a percentage being a fraction there.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const README = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const RESULTS = readFileSync(path.join(REPO_ROOT, 'RESULTS.md'), 'utf8');

/** The docs writer's order (agents/docs_writer.md), after the opening and the demo. */
const ORDER = [
  'Install',
  'Nothing leaves your browser unless you turn it on',
  'What it checks',
  'What it cannot see',
  'Results',
  'Attacks that still work',
  'Prior art',
  'How it works',
  'Contributing',
  'License',
];

/** docs_writer rule 3 and launch_engineer's, with the UI's hype words (tests/unit/copy.spec.ts). */
const BANNED =
  /\b(?:powerful|seamless(?:ly)?|enterprise[- ]grade|AI[- ]powered|powered by AI|revolutionary|magic(?:al)?|effortless(?:ly)?|cutting[- ]edge|game[- ]chang(?:er|ing)|blazing(?:ly)?|best[- ]in[- ]class)\b/iu;

/** The text from the start up to the first `## ` heading: the first screen. */
const opening = README.slice(0, README.indexOf('\n## '));

/** The text of section `heading`, up to the next `## `. */
function section(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`README.md has no section "${heading}"`);
  const next = README.indexOf('\n## ', start + 1);
  return README.slice(start, next === -1 ? undefined : next);
}

/** Every value RESULTS.md's tables hold that is a number. */
const RESULT_VALUES: readonly number[] = [...RESULTS.matchAll(/^\| [A-Za-z0-9]+ \| ([^|]+) \|$/gmu)]
  .map(([, value = '']) => value.trim())
  .filter((value) => /^-?\d+(?:\.\d+)?$/u.test(value))
  .map(Number);

const held = (value: number): boolean => RESULT_VALUES.some((result) => Math.abs(result - value) < 1e-9);

/**
 * The numbers written in `text`, a code span's, a link target's and a Chrome version's left out (a version Attest needs
 * is a requirement, not a figure): `[text, value, isPercentage]`.
 */
function numbersIn(text: string): (readonly [string, number, boolean])[] {
  const prose = text
    .replace(/`[^`]*`/gu, '')
    .replace(/\]\([^)]*\)/gu, ']')
    .replace(/\bChrome \d+/gu, 'Chrome');
  return [...prose.matchAll(/(?<![\w.§-])(\d+(?:\.\d+)?)(%?)(?![\w-])/gu)].map(
    ([written, digits = '', percent]) => [written, Number(digits), percent === '%'],
  );
}

describe('README.md', () => {
  it('says on its first screen what Attest cannot see, and links the attacks that still work', () => {
    expect(opening).toContain('**Attest cannot see everything.**');
    expect(opening).toContain('likely agent');
    expect(opening).toContain('](docs/attacks-that-work.md)');
  });

  it("has the docs writer's sections, in their order", () => {
    const headings = [...README.matchAll(/^## (.+)$/gmu)].map(([, heading = '']) => heading);
    expect(headings).toEqual(ORDER);
  });

  it('uses none of the words the docs writer never writes, and no exclamation mark outside an image', () => {
    expect(BANNED.exec(README)).toBeNull();
    expect(README.replace(/!\[/gu, '[')).not.toContain('!');
  });

  it('writes in its opening, Results and Attacks that still work only numbers RESULTS.md holds', () => {
    expect(RESULT_VALUES.length).toBeGreaterThan(100);
    const text = [opening, section('Results'), section('Attacks that still work')].join('\n');
    const written = numbersIn(text);
    expect(written.length).toBeGreaterThan(20);
    const unsourced = written
      .filter(([, value, percent]) => !held(percent ? value / 100 : value))
      .map(([raw]) => raw);
    expect(unsourced).toEqual([]);
  });
});
