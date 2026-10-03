/**
 * check-docs reads Markdown as GitHub renders it (QA-G11; docs_writer rule 4; Decisions [1.11], HR12):
 * - a backslash-escaped bracket is text, not a link (and an escaped backslash before a bracket is not an escape);
 * - an HTML comment shows nothing: a link, a command or a heading inside one is not checked or anchored, while the
 *   text after its `-->` is; inside a code span `<!--` is just text;
 * - a line indented four columns past its container is indented code: its links are text and its `pnpm` commands
 *   are checked; inside a list item four spaces only continue the item, and a line that continues a paragraph is
 *   never code.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocs } from '../../../../scripts/check-docs';
import { splitBlocks, stripComments } from '../../../../scripts/check-docs-blocks';

const BASE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ scripts: { build: 'x', test: 'y' } }),
  'extension/package.json': JSON.stringify({ scripts: { test: 'vitest run', 'test:tz': 'tz' } }),
  'policy/default.json': JSON.stringify({ rules: [{ id: 'verified' }] }),
  'docs/grading.md': '# Grading\n\nRule `verified`.\n',
  'docs/x_(y).md': '# XY\n',
  'docs/x)y.md': '# X Y\n',
  'README.md': '# Attest\n',
  'PRIVACY.md': '# Privacy\n',
};

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** The problems check-docs finds in a fixture repo whose README.md is `readme`. */
function problemsWith(readme: string): string[] {
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-docs-markdown-'));
  dirs.push(root);
  for (const [file, text] of Object.entries({ ...BASE, 'README.md': readme })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return checkDocs(root).problems.map((problem) => problem.message);
}

const MISSING = ["broken link './missing.md': missing.md does not exist"];
const NOSUCH = ["'pnpm nosuch': no script 'nosuch' in package.json"];

describe('check-docs: backslash escapes', () => {
  it.each([
    ['an escaped opening bracket', '\\[x](./missing.md)'],
    ['an escaped closing bracket', '[x\\](./missing.md)'],
    ['both brackets escaped', '\\[x\\](./missing.md)'],
  ])('%s is text, not a link', (_label, body) => {
    expect(problemsWith(`# R\n\n${body}\n`)).toEqual([]);
  });

  it('an escaped backslash before a bracket escapes nothing: the link is checked', () => {
    expect(problemsWith('# R\n\n\\\\[x](./missing.md)\n')).toEqual(MISSING);
    expect(problemsWith('# R\n\n[x\\\\](./missing.md)\n')).toEqual(MISSING);
  });

  it('an escape inside a destination is resolved, and an escaped parenthesis does not end it', () => {
    expect(problemsWith('# R\n\n[x](docs/x\\_\\(y\\).md)\n')).toEqual([]);
    expect(problemsWith('# R\n\n[x](docs/x\\)y.md)\n')).toEqual([]);
  });
});

describe('check-docs: HTML comments', () => {
  it.each([
    ['a link in a one-line comment', '<!-- [x](./missing.md) -->'],
    ['a link in a multi-line comment', '<!--\nsee [x](./missing.md)\n-->'],
    ['a fenced command in a comment', '<!--\n```sh\npnpm nosuch\n```\n-->'],
    ['a code span command in a comment', 'Text <!-- run `pnpm nosuch` --> more.'],
  ])('%s is not checked', (_label, body) => {
    expect(problemsWith(`# R\n\n${body}\n`)).toEqual([]);
  });

  it('text after a comment closes is checked, also after the shortest comments `<!-->` and `<!--->`', () => {
    expect(problemsWith('# R\n\n<!-- note --> [x](./missing.md)\n')).toEqual(MISSING);
    expect(problemsWith('# R\n\n<!--\nnote\n--> [x](./missing.md)\n')).toEqual(MISSING);
    expect(problemsWith('# R\n\n<!--> [x](./missing.md)\n')).toEqual(MISSING);
    expect(problemsWith('# R\n\n<!---> [x](./missing.md)\n')).toEqual(MISSING);
  });

  it('a heading inside a comment is no anchor', () => {
    expect(problemsWith('# R\n\n<!--\n## Hidden\n-->\n\n[x](#hidden)\n')).toEqual([
      "broken anchor '#hidden': no heading '#hidden' in README.md",
    ]);
  });

  it('`<!--` inside a code span is text and starts no comment', () => {
    expect(problemsWith('# R\n\nWrite `<!--` to start one. [x](./missing.md)\n')).toEqual(MISSING);
    expect(stripComments('a `<!--` b <!-- c --> d', false)).toEqual({ text: 'a `<!--` b   d', open: false });
  });
});

describe('check-docs: indented code blocks', () => {
  it('after a blank line, a four-space indented link is code, and its pnpm command is checked', () => {
    expect(problemsWith('# R\n\nText.\n\n    [x](./missing.md)\n')).toEqual([]);
    expect(problemsWith('# R\n\nText.\n\n    pnpm nosuch\n')).toEqual(NOSUCH);
    expect(problemsWith('# R\n\n\tpnpm nosuch\n')).toEqual(NOSUCH);
  });

  it('a cd carries through the lines of an indented block', () => {
    expect(problemsWith('# R\n\n    cd extension\n\n    pnpm test:tz\n')).toEqual([]);
  });

  it('an indented line that continues a paragraph is prose', () => {
    expect(problemsWith('# R\n\nText\n    [x](./missing.md)\n')).toEqual(MISSING);
    expect(problemsWith('# R\n\nText\n    pnpm nosuch\n')).toEqual([]);
  });

  it('inside a list item, four spaces continue the item; code needs four more', () => {
    expect(problemsWith('# R\n\n- item\n\n    [x](./missing.md)\n')).toEqual(MISSING);
    expect(problemsWith('# R\n\n1. item\n\n    [x](./missing.md)\n')).toEqual(MISSING);
    expect(problemsWith('# R\n\n- item\n\n      [x](./missing.md)\n')).toEqual([]);
    expect(problemsWith('# R\n\n- item\n\n      pnpm nosuch\n')).toEqual(NOSUCH);
    expect(problemsWith('# R\n\n- item\n  - nested\n\n        pnpm nosuch\n')).toEqual(NOSUCH);
  });

  it('after the list ends, four spaces are code again', () => {
    expect(problemsWith('# R\n\n- item\n\nText.\n\n    [x](./missing.md)\n')).toEqual([]);
  });

  it('a fence nested in a list item is still a fence', () => {
    const doc = '- step:\n\n  ```sh\n  pnpm nosuch\n  ```\n';
    expect(splitBlocks(doc).code.map((line) => [line.kind, line.text])).toEqual([
      ['fenced', '  pnpm nosuch'],
    ]);
  });
});
