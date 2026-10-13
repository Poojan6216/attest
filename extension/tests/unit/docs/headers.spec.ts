/**
 * Every document a reader is pointed to starts with its two-line header (agents/docs_writer.md rule 6; sprint_7 7.2
 * Done when): who it is for, then what they will know after, within its first lines. Each of docs/*.md, README.md and
 * PRIVACY.md; CHANGELOG.md keeps Keep a Changelog's own opening instead (tests/unit/docs/changelog.spec.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const DOCS = [
  'README.md',
  'PRIVACY.md',
  ...readdirSync(path.join(REPO_ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
];

describe('the two-line header', () => {
  it.each(DOCS)('%s says who it is for, then what they will know after, first', (doc) => {
    const lines = readFileSync(path.join(REPO_ROOT, doc), 'utf8').split('\n').slice(0, 12);
    const who = lines.findIndex((line) => line.startsWith('**Who this is for:** '));
    expect(who, 'no "Who this is for" line').toBeGreaterThan(0);
    expect(lines[who + 1]).toMatch(/^\*\*What you'll know after:\*\* \S/u);
  });

  it('covers every document under docs/', () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(8);
  });
});
