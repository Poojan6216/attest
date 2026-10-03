/**
 * scripts/check-docs.ts (task 1.11, agents/docs_writer.md rule 4): every relative link and #anchor in the docs
 * resolves, every quoted `pnpm <script>` exists, and every policy rule id is documented in docs/grading.md. The
 * golden-format and local-path checks have their own files (check-docs-scenario-keys, check-docs-local-paths).
 * Each check is proven on a fixture repo in a temp dir: clean, then broken one way at a time.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkDocs, runCli, type DocProblem } from '../../../../scripts/check-docs';
import { pnpmInvocations, scriptOf } from '../../../../scripts/check-docs-commands';
import { githubSlug, scanMarkdown } from '../../../../scripts/check-docs-markdown';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-docs.ts');

const GRADING = [
  '# Grading',
  '',
  '## 4. Candidates (`candidates.ts`)',
  '',
  'Rules `verified` and `not_found`. See [policy](../policy/default.json) and [the window](#4-candidates-candidatests).',
  '',
  '## Examples',
  '',
  '## Examples',
  '',
  'Second one: [here](#examples-1). Run `pnpm test` or `pnpm exec vitest run`.',
  '',
].join('\n');

const BASE: Readonly<Record<string, string>> = {
  // As in the repo: the root delegates `test` to the extension, so `pnpm test` at the root runs.
  'package.json': JSON.stringify({
    scripts: { build: 'x', attest: 'y', test: 'pnpm --dir extension run test' },
  }),
  'extension/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
  'policy/default.json': JSON.stringify({ rules: [{ id: 'verified' }, { id: 'not_found' }] }),
  'docs/grading.md': GRADING,
  'docs/adapters.md': '# Adapters\n\nSee [grading](grading.md#examples) and [assets](assets/).\n',
  'docs/assets/a.svg': '<svg/>',
  'README.md': '# Attest\n\n```sh\npnpm install\npnpm build\n```\n\n[Grading](docs/grading.md)\n',
  'PRIVACY.md': '# Privacy\n\n[Contact](https://example.com/issues)\n',
};

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** A fixture repo: BASE with `changes` applied (a null value deletes the file). */
function fixture(changes: Readonly<Record<string, string | null>> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-check-docs-'));
  dirs.push(root);
  const files: Record<string, string | null> = { ...BASE, ...changes };
  for (const [file, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const problems = (root: string): readonly DocProblem[] => checkDocs(root).problems;

describe('check-docs: relative links and anchors', () => {
  it('finds nothing wrong with a clean repo, and counts what it checked', () => {
    const result = checkDocs(fixture());
    expect(result.problems).toEqual([]);
    expect(result).toMatchObject({
      files: 4,
      links: 6,
      commands: 4,
      ruleIds: 2,
      scenarioKeys: 0,
      markdownFiles: 4,
    });
  });

  it('reports a broken relative link with its file, line and resolved path', () => {
    const root = fixture({ 'README.md': '# Attest\n\nSee [the model](docs/threat-model.md).\n' });
    expect(problems(root)).toEqual([
      {
        file: 'README.md',
        line: 3,
        message: "broken link 'docs/threat-model.md': docs/threat-model.md does not exist",
      },
    ]);
  });

  it('reports a broken #anchor in the same file and in another Markdown file', () => {
    const root = fixture({ 'docs/adapters.md': '# Adapters\n\n[a](#nope)\n[b](grading.md#examples-2)\n' });
    expect(problems(root).map((p) => [p.file, p.line, p.message])).toEqual([
      ['docs/adapters.md', 3, "broken anchor '#nope': no heading '#nope' in docs/adapters.md"],
      [
        'docs/adapters.md',
        4,
        "broken anchor 'grading.md#examples-2': no heading '#examples-2' in docs/grading.md",
      ],
    ]);
  });

  it('reports a link that leaves the repository even when the target exists', () => {
    const root = fixture({ 'PRIVACY.md': '[out](../../../../../../../../etc/hosts)\n' });
    expect(problems(root).map((p) => p.message)).toEqual([
      "link '../../../../../../../../etc/hosts' points outside the repository",
    ]);
  });

  it('ignores links and commands written as text inside code', () => {
    const root = fixture({
      'README.md': '# Attest\n\n`[x](missing.md)` and `pnpm-lock.yaml`\n\n```md\n[y](gone.md)\n```\n',
    });
    expect(problems(root)).toEqual([]);
  });

  it('skips external links and checks only the path part of a link with a query', () => {
    const root = fixture({
      'README.md':
        '[a](https://x.example/y) [b](mailto:a@b.example) [c](//cdn.example/z) [d](docs/grading.md?x=1)\n',
    });
    expect(checkDocs(root)).toMatchObject({ problems: [], links: 6 });
  });
});

describe('check-docs: link paths as GitHub resolves them', () => {
  it('reports a link whose letter case differs from the file, as GitHub would, on any file system', () => {
    const root = fixture({ 'README.md': '# Attest\n\n[a](docs/Grading.md) [b](DOCS/grading.md)\n' });
    // On a case-insensitive file system (macOS, Windows) the file "exists"; on Linux it does not. Both are broken.
    const insensitive = existsSync(path.join(root, 'DOCS', 'GRADING.MD'));
    const expected = (target: string) =>
      insensitive
        ? `broken link '${target}': ${target} differs in letter case from docs/grading.md`
        : `broken link '${target}': ${target} does not exist`;
    expect(problems(root).map((p) => [p.line, p.message])).toEqual([
      [3, expected('DOCS/grading.md')],
      [3, expected('docs/Grading.md')],
    ]);
  });

  it('reports a trailing slash on a file, and keeps a file whose name starts with ".." inside the repo', () => {
    const root = fixture({
      'README.md': '# Attest\n\n[a](docs/grading.md/) [b](docs/assets/) [c](..notes.md)\n',
      '..notes.md': '# Notes\n',
    });
    expect(problems(root).map((p) => p.message)).toEqual([
      "broken link 'docs/grading.md/': docs/grading.md is a file, not a directory",
    ]);
  });

  it('finds a link whose text wraps onto the next line, but not across paragraphs or list items', () => {
    const root = fixture({
      'README.md': [
        '# Attest',
        '',
        'See [the long',
        'name](wrapped.md) here.',
        '',
        'Open [bracket',
        '',
        'next](not-a-link.md)',
        '- item [one',
        '- two](not-a-link-either.md)',
        '',
      ].join('\n'),
    });
    expect(problems(root).map((p) => [p.line, p.message])).toEqual([
      [4, "broken link 'wrapped.md': wrapped.md does not exist"],
    ]);
  });
});

describe('check-docs: quoted pnpm scripts and policy rule ids', () => {
  it('reports a quoted pnpm command that names no script, in a code span or a fenced block', () => {
    const root = fixture({
      'README.md':
        '# Attest\n\nRun `pnpm deploy-docs`.\n\n```sh\npnpm --dir extension run nope\npnpm build\n```\n',
    });
    expect(problems(root).map((p) => [p.file, p.line, p.message])).toEqual([
      ['README.md', 3, "'pnpm deploy-docs': no script 'deploy-docs' in package.json"],
      ['README.md', 6, "'pnpm --dir extension run nope': no script 'nope' in extension/package.json"],
    ]);
  });

  it('reports a policy rule id that docs/grading.md does not name as inline code', () => {
    const policy = JSON.stringify({
      rules: [{ id: 'verified' }, { id: 'not_found' }, { id: 'over_ceiling' }],
    });
    expect(problems(fixture({ 'policy/default.json': policy }))).toEqual([
      {
        file: 'docs/grading.md',
        line: 0,
        message: "rule id 'over_ceiling' from policy/default.json does not appear as `over_ceiling`",
      },
    ]);
  });

  it('does not count a rule id that appears only in prose or only in a fenced block', () => {
    const grading = `${GRADING}\nThe over_ceiling rule.\n\n\`\`\`json\n{ "id": "over_ceiling" }\n\`\`\`\n`;
    const policy = JSON.stringify({
      rules: [{ id: 'verified' }, { id: 'not_found' }, { id: 'over_ceiling' }],
    });
    const found = problems(fixture({ 'docs/grading.md': grading, 'policy/default.json': policy }));
    expect(found.map((p) => p.message)).toEqual([
      "rule id 'over_ceiling' from policy/default.json does not appear as `over_ceiling`",
    ]);
  });
});

describe('check-docs: missing or unreadable inputs', () => {
  it('reports a missing README.md, PRIVACY.md or docs/grading.md, and an unreadable policy or package.json', () => {
    const root = fixture({
      'PRIVACY.md': null,
      'README.md': '# Attest\n',
      'docs/grading.md': null,
      'policy/default.json': '{ "rules": [{ "id": 3 }] }',
      'extension/package.json': '{',
      'docs/adapters.md': '# Adapters\n',
    });
    expect(problems(root).map((p) => `${p.file}: ${p.message}`)).toEqual([
      'PRIVACY.md: missing',
      'docs/grading.md: missing: every rule id in policy/default.json must be documented here',
      'extension/package.json: cannot read "scripts" from this package.json',
      'policy/default.json: cannot read rule ids from "rules" (each rule needs a string "id")',
    ]);
  });
});

describe('check-docs command line', () => {
  it('prints one line per problem and a summary, and exits 1', () => {
    const lines: string[] = [];
    const sink = (line: string) => {
      lines.push(line);
    };
    const root = fixture({ 'README.md': '[x](nope.md)\n' });
    expect(runCli(['--root', root], { log: sink, error: sink })).toBe(1);
    expect(lines).toEqual([
      "README.md:1: broken link 'nope.md': nope.md does not exist",
      'check-docs: 1 problem(s) (4 files, 6 relative links, 2 pnpm commands, 2 rule ids, 0 scenario keys, 4 Markdown files read for local paths, 0 Decisions.md lines checked for wording)',
    ]);
  });

  it('prints OK and exits 0 on a clean repo; exits 2 on bad arguments', () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
    expect(runCli(['--root', fixture()], io)).toBe(0);
    expect(out).toEqual([
      'check-docs: OK (4 files, 6 relative links, 4 pnpm commands, 2 rule ids, 0 scenario keys, 4 Markdown files read for local paths, 0 Decisions.md lines checked for wording)',
    ]);
    expect(runCli(['--rooot'], io)).toBe(2);
    expect(err).toEqual(['usage: tsx scripts/check-docs.ts [--root <dir>]']);
  });

  it('runs under tsx as a script: exit status 1 with the problem on stderr, 0 when clean', () => {
    const run = (root: string) =>
      spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, '--root', root], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
    const broken = run(fixture({ 'PRIVACY.md': '[x](gone.md)\n' }));
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain("PRIVACY.md:1: broken link 'gone.md': gone.md does not exist");
    const clean = run(fixture());
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('check-docs: OK');
  });
});

describe('the repository docs', () => {
  it('pass check-docs: every link, anchor, quoted pnpm script, policy rule id, scenario key and local path', () => {
    expect(checkDocs(REPO_ROOT).problems).toEqual([]);
  });
});

describe('GitHub heading anchors (github-slugger)', () => {
  it.each([
    ['Foo Bar', 'foo-bar'],
    ['4. Candidates (`candidates.ts`)', '4-candidates-candidatests'],
    ['Grading — how Attest decides', 'grading--how-attest-decides'],
    ['14. Deviations from build_spec §7', '14-deviations-from-build_spec-7'],
    ['16.12 Time-zone edge: 23:58 and 00:01', '1612-time-zone-edge-2358-and-0001'],
    ['Привет non-latin 你好', 'привет-non-latin-你好'],
    ['emoji 😄', 'emoji-'],
  ])('%s → %s', (heading, slug) => {
    const anchors = scanMarkdown(`## ${heading}\n`).anchors;
    expect(anchors).toEqual(new Set([slug]));
  });

  it('numbers repeated headings -1, -2 and reads setext headings and HTML ids', () => {
    const doc = 'Intro\n=====\n\n## Intro\n\n## Intro\n\nText\n---\n\n<a id="here"></a>\n';
    expect([...scanMarkdown(doc).anchors].sort()).toEqual(['here', 'intro', 'intro-1', 'intro-2', 'text']);
  });

  it('drops emphasis and link markup but keeps underscores inside words and code', () => {
    expect(githubSlug('a_b')).toBe('a_b');
    expect([...scanMarkdown('## *Bold* and [link](x.md) `no_coverage`\n').anchors]).toEqual([
      'bold-and-link-no_coverage',
    ]);
  });
});

describe('quoted pnpm commands', () => {
  it.each([
    ['pnpm test', 'test'],
    ['pnpm attest replay <export.json>', 'attest'],
    ['pnpm run bench', 'bench'],
    ['pnpm --dir extension run dev', 'dev'],
    ['pnpm -C extension test:perf', 'test:perf'],
    ['pnpm install', null],
    ['pnpm exec vitest run tests/golden', null],
  ])('%s needs script %s', (code, script) => {
    expect(pnpmInvocations(code).map((invocation) => invocation.script)).toEqual([script]);
  });

  it('finds every invocation in a shell line and ignores pnpm-lock.yaml and paths', () => {
    const code = 'cd extension && pnpm exec tsx a.ts; pnpm lint | cat # pnpm-lock.yaml ./bin/pnpm';
    const extension = { kind: 'dir', dir: 'extension' };
    expect(pnpmInvocations(code)).toEqual([
      { text: 'pnpm exec tsx a.ts', script: null, target: extension },
      { text: 'pnpm lint', script: 'lint', target: extension },
    ]);
    expect(scriptOf('')).toBeNull();
  });
});
