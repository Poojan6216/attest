/**
 * check-docs edge cases (scripts/check-docs*.ts; docs_writer rule 4; Decisions [1.11] "Protects HR12 (no doc claims
 * a command or rule that does not exist)"; QA Sprint 1 review). check-docs.spec.ts covers the main paths; mutation
 * probes showed the `#` comment guard and the path lookbehind of `pnpm` invocations untested (QA-G9), and a probe
 * showed a root-level command that only extension/package.json defines passing the check (QA-G10): `pnpm test:tz`
 * typed at the repo root fails ("missing script"), so check-docs now looks a script up in the package the command
 * runs in. check-docs-targets.spec.ts covers how that package is found; check-docs-markdown-edges.spec.ts covers
 * escapes, HTML comments and indented code (QA-G11).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocs } from '../../../../scripts/check-docs';
import { pnpmInvocations } from '../../../../scripts/check-docs-commands';

const BASE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ scripts: { build: 'x', attest: 'y', test: 'z' } }),
  'extension/package.json': JSON.stringify({ scripts: { test: 'vitest run', 'test:tz': 'tz' } }),
  'policy/default.json': JSON.stringify({ rules: [{ id: 'verified' }] }),
  'docs/grading.md': '# Grading\n\nRule `verified`.\n\n## Odd: heading? (yes) — ok\n',
  'docs/a b.md': '# A B\n',
  'docs/x_(y).md': '# XY\n',
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
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-docs-edges-'));
  dirs.push(root);
  for (const [file, text] of Object.entries({ ...BASE, 'README.md': readme })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return checkDocs(root).problems.map((problem) => problem.message);
}

const MISSING = ["broken link './missing.md': missing.md does not exist"];

describe('check-docs: link forms', () => {
  it.each([
    ['a reference-style link', 'See [x][r].\n\n[r]: ./missing.md'],
    ['a link with a title', '[x](./missing.md "title")'],
    ['an HTML href', '<a href="./missing.md">x</a>'],
    ['a link in a table cell', '| a | b |\n|---|---|\n| [x](./missing.md) | y |'],
    ['a link in a blockquote', '> see [x](./missing.md)'],
    ['a link in a list item', '- see [x](./missing.md)'],
  ])('%s to a missing file is reported', (_label, body) => {
    expect(problemsWith(`# R\n\n${body}\n`)).toEqual(MISSING);
  });

  it('an image to a missing file is reported', () => {
    expect(problemsWith('# R\n\n![alt](./missing.png)\n')).toEqual([
      "broken link './missing.png': missing.png does not exist",
    ]);
  });

  it.each([
    ['an angle-bracket destination with a space', '[x](<docs/a b.md>)'],
    ['a percent-encoded space', '[x](docs/a%20b.md)'],
    ['a title after an existing file', '[x](docs/grading.md "title")'],
    ['balanced parentheses in the path', '[x](docs/x_(y).md)'],
    ['an anchor to a heading with punctuation and a dash', '[x](docs/grading.md#odd-heading-yes--ok)'],
  ])('%s resolves', (_label, body) => {
    expect(problemsWith(`# R\n\n${body}\n`)).toEqual([]);
  });
});

describe('check-docs: pnpm invocations', () => {
  it('a `#` after pnpm starts a shell comment, not a script name', () => {
    expect(pnpmInvocations('pnpm # install first').map((invocation) => invocation.script)).toEqual([null]);
    expect(problemsWith('# R\n\n```sh\npnpm # install first\n```\n')).toEqual([]);
  });

  it('pnpm reached through a path or inside a longer word is not an invocation', () => {
    expect(pnpmInvocations('/usr/local/bin/pnpm nosuch; mypnpm nosuch; x-pnpm nosuch')).toEqual([]);
    expect(problemsWith('# R\n\n```sh\n/usr/local/bin/pnpm nosuch\n```\n')).toEqual([]);
  });

  it('a command that names the extension directory may run an extension script', () => {
    expect(problemsWith('# R\n\n```sh\npnpm -C extension test:tz\n```\n')).toEqual([]);
    expect(problemsWith('# R\n\n```sh\npnpm --dir extension run test:tz\n```\n')).toEqual([]);
  });

  it('a root-level command that only extension/package.json defines is reported (QA-G10)', () => {
    expect(problemsWith('# R\n\n```sh\npnpm test:tz\n```\n')).toEqual([
      "'pnpm test:tz': no script 'test:tz' in package.json",
    ]);
    expect(problemsWith('# R\n\nRun `pnpm run test:tz`.\n')).toEqual([
      "'pnpm run test:tz': no script 'test:tz' in package.json",
    ]);
  });
});
