/**
 * docs/assets/receipt-states.svg, the §8 state-machine diagram (task 1.11; agents/docs_writer.md rule 5: SVG in
 * the repo, legible in dark mode, no external renderer). Legibility does not rest on a media query (which follows
 * the operating system, not the page): the background is transparent and every colour must hold 4:1 contrast
 * against both a white page and GitHub's dark page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { describeDiagram, nestingProblems, readDiagram } from './svg-checks';
import { REPO_ROOT } from './worked-examples-check';

const { svg: SVG } = readDiagram('receipt-states.svg');
const DOC = readFileSync(path.join(REPO_ROOT, 'docs', 'grading.md'), 'utf8');

describeDiagram('receipt-states.svg');

describe('the nesting check', () => {
  it('catches an unclosed element', () => {
    expect(nestingProblems('<svg><g><text>x</g></svg>')).toEqual([
      '</g> closes the wrong element',
      '</svg> closes the wrong element',
      '<svg> never closes',
    ]);
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
