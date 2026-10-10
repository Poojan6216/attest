/**
 * docs/threat-model.md (sprint_6 6.8 Done when: "every 'attacks that work' row is referenced"; agents/docs_writer.md):
 * it opens with who it is for and what the reader will know after, and its §7 table has a row for every attack in
 * docs/attacks-that-work.md's "Attacks that work" table, by its strategy number, so an attack published there and left
 * out here fails. The check runs on a copy with a row taken out, to prove it can fail.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './worked-examples-check';

const read = (file: string): string => readFileSync(path.join(REPO_ROOT, 'docs', file), 'utf8');
const THREATS = read('threat-model.md');
const ATTACKS = read('attacks-that-work.md');

/** The strategy numbers of the rows of the table under `heading` (from it to the next heading). */
function rowNumbers(doc: string, heading: string): string[] {
  const start = doc.indexOf(`${heading}\n`);
  if (start < 0) return [];
  const rest = doc.slice(start + heading.length + 1);
  const end = rest.search(/^#{1,6} /mu);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\| (\d+) \|/gmu)].map(([, number = '']) => number);
}

/** The attacks that work, by number, that `threats`' §7 table does not reference. */
function unreferenced(threats: string): string[] {
  const referenced = new Set(rowNumbers(threats, "## 7. The red team's results"));
  return rowNumbers(ATTACKS, '### Attacks that work').filter((number) => !referenced.has(number));
}

describe('docs/threat-model.md', () => {
  it('opens with who it is for and what the reader will know after', () => {
    const [title = '', , who = '', what = ''] = THREATS.split('\n');
    expect(title).toBe('# Threat model');
    expect(who).toMatch(/^\*\*Who this is for:\*\* \S/u);
    expect(what).toMatch(/^\*\*What you'll know after:\*\* \S/u);
  });

  it('references every attack that works, by its number', () => {
    expect(rowNumbers(ATTACKS, '### Attacks that work').length).toBeGreaterThan(0);
    expect(unreferenced(THREATS)).toEqual([]);
  });

  it('fails a copy with an attack left out', () => {
    const withoutTen = THREATS.replace(/^\| 10 \|.*\n/mu, '');
    expect(unreferenced(withoutTen)).toEqual(['10']);
  });
});
