/**
 * docs/assets/trust-boundaries.svg, the threat model's diagram (sprint_6 6.8; agents/docs_writer.md rule 5): the
 * checks every diagram holds to (./svg-checks.ts), and its content: each component and boundary of docs/threat-model.md
 * §4, and its place in that section.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { describeDiagram, readDiagram } from './svg-checks';
import { REPO_ROOT } from './worked-examples-check';

const { svg: SVG } = readDiagram('trust-boundaries.svg');
const DOC = readFileSync(path.join(REPO_ROOT, 'docs', 'threat-model.md'), 'utf8');

describeDiagram('trust-boundaries.svg');

describe('docs/assets/trust-boundaries.svg: content', () => {
  it('shows every component and every boundary of §4', () => {
    for (const box of [
      'Vendor page',
      'Content script',
      'Service worker',
      'Ledger',
      'Extension pages',
      'You',
      'Model company',
      'Telemetry server',
    ]) {
      expect(SVG).toContain(`>${box}</text>`);
    }
    for (const boundary of ['1 · page → extension', '2 · content script → worker', '3 · browser → network']) {
      expect(SVG).toContain(boundary);
    }
  });

  it('is embedded in §4 of docs/threat-model.md', () => {
    const section4 = DOC.slice(DOC.indexOf('\n## 4. '), DOC.indexOf('\n## 5. '));
    expect(section4).toMatch(/!\[[^\]]+\]\(assets\/trust-boundaries\.svg\)/);
  });
});
