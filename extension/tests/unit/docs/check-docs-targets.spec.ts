/**
 * check-docs looks a quoted `pnpm <script>` up in the package the command runs in, never in the union of every
 * package.json (QA-G10; docs_writer rule 4; Decisions [1.11], HR12: no doc claims a command that does not exist).
 * The repo root is where a doc's commands start; a `cd` (carried to later lines of the same code block), `-C`/`--dir`,
 * `--filter`, `-w` or a recursive run moves them. A command whose package cannot be known is reported, not passed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocs } from '../../../../scripts/check-docs';
import { cwdAfter, pnpmInvocations } from '../../../../scripts/check-docs-commands';

const BASE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'attest-workspace', scripts: { build: 'x', test: 'y' } }),
  'extension/package.json': JSON.stringify({
    name: 'attest',
    scripts: { test: 'vitest run', 'test:tz': 'tz' },
  }),
  'policy/default.json': JSON.stringify({ rules: [{ id: 'verified' }] }),
  'docs/grading.md': '# Grading\n\nRule `verified`.\n',
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
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-docs-targets-'));
  dirs.push(root);
  for (const [file, text] of Object.entries({ ...BASE, 'README.md': readme })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return checkDocs(root).problems.map((problem) => problem.message);
}

const sh = (...lines: string[]) => `# R\n\n\`\`\`sh\n${lines.join('\n')}\n\`\`\`\n`;

describe('check-docs: the directory a command runs in', () => {
  it.each([
    ['a cd before it on the same line', sh('cd extension && pnpm test:tz')],
    ['a cd on an earlier line of the same block', sh('cd extension', 'pnpm test:tz')],
    ['a cd into a folder of the package', sh('cd extension/tests && pnpm test:tz')],
    ['a cd in an inline code span', '# R\n\nRun `cd extension && pnpm test:tz`.\n'],
    ['-C', sh('pnpm -C extension test:tz')],
    ['--dir=', sh('pnpm --dir=extension run test:tz')],
    ['a cd and back', sh('cd extension && cd .. && pnpm build')],
  ])('%s: the script is looked up there', (_label, readme) => {
    expect(problemsWith(readme)).toEqual([]);
  });

  it('a cd lasts to the end of its code block only', () => {
    const readme = `${sh('cd extension', 'pnpm test:tz')}\n${sh('pnpm test:tz')}`;
    expect(problemsWith(readme)).toEqual(["'pnpm test:tz': no script 'test:tz' in package.json"]);
  });

  it('a script only the root defines fails inside the extension', () => {
    expect(problemsWith(sh('cd extension && pnpm build'))).toEqual([
      "'pnpm build': no script 'build' in extension/package.json",
    ]);
  });

  it('a directory a doc cannot know is reported, not passed', () => {
    expect(problemsWith(sh('cd ~/attest && pnpm test'))).toEqual([
      "'pnpm test': cannot tell which package.json it runs in (it runs after a cd that leaves the repository)",
    ]);
    expect(problemsWith(sh('pnpm --dir ../.. test'))).toEqual([
      "'pnpm --dir ../.. test': cannot tell which package.json it runs in (--dir '../..' leaves the repository)",
    ]);
    expect(problemsWith(sh('cd /tmp && pnpm install'))).toEqual([]); // pnpm's own command: no script needed
  });

  it('a cd inside a shell comment changes nothing', () => {
    expect(cwdAfter('pnpm build # then: cd extension', '.')).toBe('.');
    expect(cwdAfter('cd extension # go there', '.')).toBe('extension');
  });
});

describe('check-docs: filters, the workspace root and recursive runs', () => {
  it.each([
    ['a --filter by package name', sh('pnpm --filter attest test:tz')],
    ['a -F by directory', sh('pnpm -F ./extension run test:tz')],
    ['a --filter by {directory}', sh('pnpm --filter {extension} test:tz')],
    ['a --filter glob', sh('pnpm --filter "att*" test:tz')],
    ['-w from inside the extension', sh('cd extension && pnpm -w build')],
    ['-r', sh('pnpm -r test:tz')],
    ['pnpm recursive run', sh('pnpm recursive run test:tz')],
    ['-r with the workspace root', sh('pnpm -r --include-workspace-root build')],
    ['pnpm t, an alias of pnpm test', sh('pnpm t')],
  ])('%s', (_label, readme) => {
    expect(problemsWith(readme)).toEqual([]);
  });

  it.each([
    ['-w', sh('pnpm -w test:tz'), "'pnpm -w test:tz': no script 'test:tz' in package.json"],
    [
      '-r without the root',
      sh('pnpm -r build'),
      "'pnpm -r build': no script 'build' in extension/package.json",
    ],
    [
      'a filter that selects nothing',
      sh('pnpm --filter nosuch test'),
      "'pnpm --filter nosuch test': --filter 'nosuch' selects no package",
    ],
  ])('%s is reported', (_label, readme, message) => {
    expect(problemsWith(readme)).toEqual([message]);
  });

  it('reports where each invocation runs', () => {
    expect(
      pnpmInvocations('pnpm -r test; pnpm --filter attest test; pnpm test').map((i) => i.target),
    ).toEqual([
      { kind: 'recursive', includeRoot: false },
      { kind: 'filter', selector: 'attest', dir: '.' },
      { kind: 'dir', dir: '.' },
    ]);
  });
});
