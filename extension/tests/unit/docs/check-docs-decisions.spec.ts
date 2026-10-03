/**
 * check-docs rule 6 (TECH-R13, Sprint 1 close C6): from the Sprint 1 close on, a Decisions.md entry says what was
 * decided and why, in project terms, never how the work on it was organised. scripts/check-docs-decisions.ts finds
 * such wording; this file proves what it reports, what it leaves alone (earlier entries, ordinary words), that
 * check-docs runs it with file and line, and that the real Decisions.md is clean.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocs } from '../../../../scripts/check-docs';
import { decisionResidue } from '../../../../scripts/check-docs-decisions';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** A Decisions.md whose checked part (from the first [1.close] entry) is `entry`, after one older entry. */
const decisions = (entry: string): string =>
  [
    '# Decisions.md',
    '',
    '- 2026-10-01 [1.0] Per the brief, the contract wins; another agent was editing schema.ts (this run).',
    `- 2026-10-02 [1.close] ${entry}`,
    '',
  ].join('\n');

describe('decisionResidue: wording about how the work was organised', () => {
  it.each([
    ['The change for each is in ownershipNeeds.', 'ownershipNeeds'],
    ['not in the order the docsNeeds text used', 'docsNeeds'],
    ['the replay fixer made it', 'fixer'],
    ['which other Fixers own', 'fixer'],
    ['the [1.11] out-of-ownership list', 'ownership'],
    ['as the brief said', 'brief'],
    ["beyond the brief's three outcomes", 'brief'],
    ['This run: I changed the test', 'this run'],
    ['I created it in the first run', 'first run'],
    ['left for the later agent', 'later agent'],
    ['two files I do not own', 'I own'],
    ['bench tooling (which I own)', 'I own'],
    ["files I don't own", 'I own'],
    ['added by another owner', 'another owner'],
    ['until their owners apply it', 'another owner'],
  ])('reports %s', (entry, term) => {
    expect(decisionResidue(decisions(entry)).map((hit) => [hit.line, hit.term])).toEqual([[4, term]]);
  });

  it.each([
    [
      'ordinary words',
      'Every run is checked; each claim has an owner field; read briefly; the run count stays 3.',
    ],
    ['words that only contain a term', 'refixer, ownerships, briefing, firstrun, I owned nothing'],
    ['a project word beside a term', 'the first runs of the bench; the account owner'],
  ])('leaves %s alone', (_what, entry) => {
    expect(decisionResidue(decisions(entry))).toEqual([]);
  });

  it('reads nothing before the first [1.close] entry, and nothing at all without one', () => {
    const older = '- 2026-10-01 [1.0] Per the brief, another agent did this run.\n';
    expect(decisionResidue(`# Decisions\n\n${older}`)).toEqual([]);
    expect(decisionResidue(decisions('Clean.'))).toEqual([]);
  });

  it('reads every entry after the first [1.close] one, whatever its tag, with its own line', () => {
    const text = `${decisions('Clean.')}- 2026-10-03 [2.1] Left for the later agent.\n\nSee ownershipNeeds.\n`;
    expect(decisionResidue(text)).toEqual([
      { line: 5, term: 'later agent', found: 'later agent' },
      { line: 7, term: 'ownershipNeeds', found: 'ownershipNeeds' },
    ]);
  });

  it('reports every term on a line, as written', () => {
    const hits = decisionResidue(decisions('This run: the fixer did it, as the Brief said.'));
    expect(hits.map((hit) => hit.found)).toEqual(['fixer', 'Brief', 'This run']);
  });
});

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-docs-decisions-'));
  dirs.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('check-docs runs the Decisions.md wording check', () => {
  it('reports the wording with file and line, and counts the lines it checked', () => {
    const root = tree({
      'package.json': JSON.stringify({ scripts: {} }),
      'extension/package.json': JSON.stringify({ scripts: {} }),
      'policy/default.json': JSON.stringify({ rules: [{ id: 'verified' }] }),
      'docs/grading.md': '# Grading\n\nRule `verified`.\n',
      'README.md': '# Attest\n',
      'PRIVACY.md': '# Privacy\n',
      'Decisions.md': decisions('Two files I do not own are pending.'),
    });
    const result = checkDocs(root);
    expect(result.problems.map((p) => [p.file, p.line, p.message])).toEqual([
      [
        'Decisions.md',
        4,
        "'I do not own' describes how the work was organised, not the decision: write it in project terms",
      ],
    ]);
    expect(result.decisionLines).toBe(2);
  });

  it('checks nothing in a repository without Decisions.md', () => {
    const root = tree({ 'package.json': JSON.stringify({ scripts: {} }), 'README.md': '# A\n' });
    expect(checkDocs(root).decisionLines).toBe(0);
  });

  it('finds none in the real Decisions.md, from the Sprint 1 close to its end', () => {
    const text = readFileSync(path.join(REPO_ROOT, 'Decisions.md'), 'utf8');
    expect(text).toMatch(/^- \d{4}-\d{2}-\d{2} \[1\.close\]/m);
    expect(decisionResidue(text)).toEqual([]);
    expect(checkDocs(REPO_ROOT).decisionLines).toBeGreaterThan(100);
  });
});
