/**
 * check-docs rule 5 (TECH-R13): no committed Markdown file holds an absolute local path. Such a path is useless to
 * every other reader and leaks the account name and scratch layout of the machine that wrote it once the repository
 * is public. scripts/check-docs-paths.ts finds them; this file proves what it reports, what it leaves alone (relative
 * paths, URLs, `~/`, placeholders), which files it reads, and that the real repository is clean.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocs } from '../../../../scripts/check-docs';
import { localPaths, markdownFiles } from '../../../../scripts/check-docs-paths';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

describe('localPaths: absolute paths of one machine', () => {
  it.each([
    ['Files: /Users/someone/Documents/Attest/x.ts', '/Users/someone'],
    ['see (/home/dev/attest)', '/home/dev'],
    ['probe in `/private/tmp/claude-501/scratch/mut`', '/private/tmp'],
    ['"/private/var/folders/ab/T/x"', '/private/var'],
    ['TMPDIR=/var/folders/ab/T', '/var/folders/ab'],
    ['wrote /tmp/attest-run.json', '/tmp/attest-run.json'],
    [String.raw`C:\Users\dev\attest`, String.raw`C:\Users\dev`],
    ['C:/Users/dev/attest', 'C:/Users/dev'],
    ['open file:///Users/x/report.html', 'file:///'],
  ])('reports %s', (line, found) => {
    expect(localPaths(line)).toEqual([{ line: 1, path: found }]);
  });

  it.each([
    ['a relative path', 'extension/Users/x and docs/home/page.md and src/tmp/x'],
    ['a URL path', 'https://example.com/home/dev and https://example.com/Users/x'],
    ['the home shorthand', 'installed to `~/.local/bin` and "$HOME/.attest-capture-profile"'],
    ['a placeholder', 'a path like `/Users/<name>` or `/private/tmp/…`'],
    ['a grep alternation', 'grep -E "Verdict|/private/tmp|~" Decisions.md'],
    ['a bare directory name', 'the /tmp directory, and /Users on a Mac'],
    ['a scratchpad named by its relative path', 'scratchpad/review1/security/probe.ts'],
  ])('leaves %s alone', (_what, line) => {
    expect(localPaths(line)).toEqual([]);
  });

  it('reports every path with its own line, in order', () => {
    const text = '# Notes\n\nfirst /Users/a/x and /home/b/y\n\nthen /private/tmp/z/w\n';
    expect(localPaths(text)).toEqual([
      { line: 3, path: '/Users/a' },
      { line: 3, path: '/home/b' },
      { line: 5, path: '/private/tmp' },
    ]);
  });
});

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-docs-paths-'));
  dirs.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('markdownFiles: every committed Markdown file', () => {
  it('walks the whole tree but skips dependencies, dot-directories and test or coverage output', () => {
    const root = tree({
      'README.md': '',
      'Decisions.md': '',
      'docs/grading.md': '',
      'reviews/sprint_1/qa.md': '',
      'extension/tests/golden/README.md': '',
      'notes.txt': '',
      'node_modules/pkg/README.md': '',
      'extension/node_modules/pkg/CHANGELOG.md': '',
      '.git/info.md': '',
      'extension/.output/x.md': '',
      'extension/test-results/run/error-context.md': '',
      'extension/playwright-report/index.md': '',
      'extension/coverage/summary.md': '',
      'extension/blob-report/x.md': '',
    });
    expect(markdownFiles(root)).toEqual([
      'Decisions.md',
      'README.md',
      'docs/grading.md',
      'extension/tests/golden/README.md',
      'reviews/sprint_1/qa.md',
    ]);
  });
});

describe('check-docs runs the local-path check', () => {
  it('reports a path in Decisions.md and in a review, with file and line, and none from node_modules', () => {
    const root = tree({
      'package.json': JSON.stringify({ scripts: {} }),
      'extension/package.json': JSON.stringify({ scripts: {} }),
      'policy/default.json': JSON.stringify({ rules: [{ id: 'verified' }] }),
      'docs/grading.md': '# Grading\n\nRule `verified`.\n',
      'README.md': '# Attest\n',
      'PRIVACY.md': '# Privacy\n',
      'Decisions.md': '# Decisions\n\n- 2026-10-02 [1.3] Files changed: /Users/someone/Attest/a.ts\n',
      'reviews/sprint_9/qa.md': '# QA\n\nRaw output in /private/tmp/claude-501/x/qa.txt\n',
      'node_modules/pkg/README.md': 'Built on /home/builder/pkg\n',
    });
    const result = checkDocs(root);
    expect(result.markdownFiles).toBe(5);
    expect(result.problems.map((p) => [p.file, p.line, p.message])).toEqual([
      ['Decisions.md', 3, "absolute local path '/Users/someone': write a path relative to the repository"],
      [
        'reviews/sprint_9/qa.md',
        3,
        "absolute local path '/private/tmp': write a path relative to the repository",
      ],
    ]);
  });

  it('finds none in the repository, after reading every committed Markdown file', () => {
    const result = checkDocs(REPO_ROOT);
    expect(result.problems.filter((p) => p.message.startsWith('absolute local path'))).toEqual([]);
    const files = markdownFiles(REPO_ROOT);
    expect(result.markdownFiles).toBe(files.length);
    for (const file of ['CHANGELOG.md', 'Decisions.md', 'PRIVACY.md', 'README.md', 'docs/grading.md']) {
      expect(files).toContain(file);
    }
    expect(files.some((file) => file.startsWith('reviews/'))).toBe(true);
  });
});
