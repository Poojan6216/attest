/**
 * README.md (sprint_7 7.1; agents/docs_writer.md; Sprint 7 close, tech review TECH-3): a reader who reads only its first
 * screen knows what Attest cannot do, every one of build_spec §11's limits (./copy-rules.ts SECTION_11_LIMITS), and
 * where the attacks that still work are; its sections come in the docs writer's order; and it uses none of the words no
 * copy uses and no exclamation mark. Its numbers are held to their metrics elsewhere: its first screen's and its
 * sections' prose by ./figures.spec.ts, its Results and Attacks tables by ./readme-figures.spec.ts.
 */
import { describe, expect, it } from 'vitest';

import { HYPE, missingLimits, read, SECTION_11_LIMITS, section } from './copy-rules';

const README = read('README.md');

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

/** The text from the start up to the first `## ` heading: the first screen. */
const opening = README.slice(0, README.indexOf('\n## '));

describe('README.md', () => {
  it("states every one of build_spec §11's limits on its first screen, and links the attacks that still work", () => {
    expect(missingLimits(opening)).toEqual([]);
    expect(opening).toContain('](docs/attacks-that-work.md)');
  });

  it("holds one entry for each of build_spec §11's limits", () => {
    const limits = section(read('build_spec.md'), '11. Known limitations to document, not fix');
    expect(SECTION_11_LIMITS).toHaveLength([...limits.matchAll(/^- /gmu)].length);
  });

  it("has the docs writer's sections, in their order", () => {
    const headings = [...README.matchAll(/^## (.+)$/gmu)].map(([, heading = '']) => heading);
    expect(headings).toEqual(ORDER);
  });

  it('uses none of the words no copy uses, and no exclamation mark outside an image', () => {
    expect(HYPE.exec(README)).toBeNull();
    expect(README.replace(/!\[/gu, '[')).not.toContain('!');
  });
});
