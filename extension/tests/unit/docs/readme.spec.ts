/**
 * README.md (sprint_7 7.1; agents/docs_writer.md): a reader who reads only its first screen knows what Attest cannot do
 * and where the attacks that still work are; its sections come in the docs writer's order; it uses none of the words
 * the docs writer never writes; and every number in its opening, its Results and its Attacks that still work is one
 * RESULTS.md holds (Sprint 7's rule: every number in public traces to RESULTS.md), a percentage being a fraction there.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { numbersIn, RESULT_VALUES, unsourced } from './public-numbers';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const README = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

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
    expect(numbersIn(text).length).toBeGreaterThan(20);
    expect(unsourced(text)).toEqual([]);
  });
});
