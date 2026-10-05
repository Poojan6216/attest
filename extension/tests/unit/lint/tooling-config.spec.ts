/**
 * Pins the test tooling the Sprint 1 close settled (QA-R1, QA-G2, QA-VG1, TECH-R3, QA-R4, TECH-R2, QA-R8):
 * - one suite-wide timeout of 60 s, so no heavy property or lint test falls back to Vitest's 5 s default and fails
 *   under load with no defect (a timeout guards a hang, it is not an assertion), and no retries anywhere;
 * - `pnpm test:coverage` measures src/core only and fails below 95% lines (the Gate), writing its report even
 *   when a test fails, and CI runs it;
 * - the perf pass prints each gate's medians, also when the gate passes;
 * - the `gate` tag exists and the Sprint 1 grep test over src/core carries it (TECH-R1, QA-R7);
 * - every test's timeout is checked as it runs, in both runs (FR3-7);
 * - the poisoned run (FR3-4): every core, golden and property test under the runtime guard, installed before src/core
 *   loads, with a binding 95% line floor on src/core under the guard; `pnpm test:poison` runs it and CI runs that;
 * - the pre-push hook (scripts/pre-push.sh) tests the commit each pushed ref points to, in a temporary detached
 *   worktree, never the working tree: an uncommitted file can neither block nor pass a push. Pinned by its text and
 *   proven by running it on a throwaway repository with a fake `pnpm` that records what it tested.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import vitestConfig, { CORE_COVERAGE_LINES, TEST_TIMEOUT_MS } from '../../../vitest.config';
import perfConfig from '../../../vitest.perf.config';
import poisonConfig, {
  POISON_EXCLUDE,
  POISON_INCLUDE,
  POISON_INDEX_ALIAS,
  POISON_LEDGER_EXCLUDE,
  POISON_SETUP,
  TIMEOUT_SETUP,
} from '../../../vitest.poison.config';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const REPO = path.resolve(EXTENSION, '..');

const readJson = (file: string) =>
  JSON.parse(readFileSync(file, 'utf8')) as { scripts: Record<string, string> };

describe('vitest.config.ts: timeouts and retries', () => {
  it('sets one suite-wide test timeout of 60 s', () => {
    expect(TEST_TIMEOUT_MS).toBe(60_000);
    expect(vitestConfig.test?.testTimeout).toBe(TEST_TIMEOUT_MS);
  });

  it('never retries a failing test, in either pass', () => {
    expect(vitestConfig.test?.retry ?? 0).toBe(0);
    expect(perfConfig.test?.retry ?? 0).toBe(0);
  });

  it('declares the gate tag, and the Sprint 1 grep test over src/core carries it (TECH-R1, QA-R7)', () => {
    expect(vitestConfig.test?.tags?.map((tag) => tag.name)).toContain('gate');
    const purity = readFileSync(path.join(EXTENSION, 'tests/unit/core/core-purity.spec.ts'), 'utf8');
    expect(purity).toContain("const GATE = { tags: ['gate'] };");
    expect(purity).toMatch(/describe\('src\/core purity on the real files[^']*', GATE, /);
  });
});

describe('core coverage (the Gate: core coverage >= 95%)', () => {
  it('measures src/core with v8, fails below 95% lines, and reports even when a test fails', () => {
    expect(CORE_COVERAGE_LINES).toBe(95);
    expect(vitestConfig.test?.coverage).toMatchObject({
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      thresholds: { lines: CORE_COVERAGE_LINES },
      reportOnFailure: true,
    });
  });

  it('has a test:coverage script in both package.json files, and CI runs it', () => {
    expect(readJson(path.join(EXTENSION, 'package.json')).scripts['test:coverage']).toBe(
      'vitest run --coverage',
    );
    expect(readJson(path.join(REPO, 'package.json')).scripts['test:coverage']).toBe(
      'pnpm --dir extension run test:coverage',
    );
    const ci = readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('      - name: Core coverage\n        run: pnpm test:coverage\n');
  });
});

describe('vitest.perf.config.ts: the medians are printed', () => {
  it('keeps the console output of a passing gate', () => {
    expect(perfConfig.test?.silent).toBe(false);
  });
});

describe('the suite-wide timeout is checked on every test as it runs (FR3-7)', () => {
  it('both runs load the setup file that checks it', () => {
    expect(vitestConfig.test?.setupFiles).toContain(TIMEOUT_SETUP);
    expect(poisonConfig.test?.setupFiles).toContain(TIMEOUT_SETUP);
  });
});

describe('the poisoned run (FR3-4): core, golden and property tests under the runtime guard', () => {
  it("runs every core, golden and property test but the guard's own specs, with the guard set up first", () => {
    expect(POISON_INCLUDE).toEqual([
      'tests/unit/core/**/*.spec.ts',
      'tests/golden/**/*.spec.ts',
      'tests/property/**/*.spec.ts',
    ]);
    expect(POISON_EXCLUDE).toEqual(['tests/unit/core/core-poison*.spec.ts']);
    expect(poisonConfig.test?.include).toEqual(POISON_INCLUDE);
    expect(poisonConfig.test?.exclude).toEqual(expect.arrayContaining(POISON_EXCLUDE));
    // Only the ledger's own property suites (fake-indexeddb, a pinned clock) leave the guarded run, and the candidate
    // tests swap to the memory index there (it does no I/O); the main run keeps both implementations.
    expect(POISON_LEDGER_EXCLUDE).toEqual([
      'tests/property/candidates-ledger-index.property.spec.ts',
      'tests/property/calendar-third-party.property.spec.ts',
      'tests/property/ledger/**/*.spec.ts',
    ]);
    expect(poisonConfig.test?.exclude).toEqual(expect.arrayContaining(POISON_LEDGER_EXCLUDE));
    expect(POISON_INDEX_ALIAS).toBe('tests/unit/ledger/index-implementations-memory.ts');
    expect(poisonConfig.test?.setupFiles).toEqual([TIMEOUT_SETUP, POISON_SETUP]);
    expect(poisonConfig.test?.testTimeout).toBe(TEST_TIMEOUT_MS);
    expect(poisonConfig.test?.retry ?? 0).toBe(0);
  });

  it('measures src/core under the guard and fails below 95% lines', () => {
    expect(poisonConfig.test?.coverage).toMatchObject({
      provider: 'v8',
      enabled: true,
      include: ['src/core/**/*.ts'],
      thresholds: { lines: CORE_COVERAGE_LINES },
      reportOnFailure: true,
    });
  });

  it('has a test:poison script in both package.json files, and CI runs it', () => {
    expect(readJson(path.join(EXTENSION, 'package.json')).scripts['test:poison']).toBe(
      'vitest run --config vitest.poison.config.ts',
    );
    expect(readJson(path.join(REPO, 'package.json')).scripts['test:poison']).toBe(
      'pnpm --dir extension run test:poison',
    );
    const ci = readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('      - name: Core under the runtime guard\n        run: pnpm test:poison\n');
  });
});

describe('the pre-push hook tests the commit each pushed ref points to, never the working tree', () => {
  const HOOK = readFileSync(path.join(REPO, 'scripts/pre-push.sh'), 'utf8');

  it('is wired through simple-git-hooks, next to the unchanged pre-commit hook', () => {
    const root = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
      'simple-git-hooks': Record<string, string>;
    };
    expect(root['simple-git-hooks']).toEqual({
      'pre-commit': 'pnpm lint && pnpm typecheck',
      'pre-push': 'bash scripts/pre-push.sh',
    });
  });

  it('runs pnpm test in a temporary detached worktree of each pushed tip commit, and always removes it', () => {
    expect(HOOK).toContain('worktree add --detach');
    expect(HOOK).toContain('(cd "$WORKTREE" && pnpm test)');
    expect(HOOK).toContain('trap cleanup EXIT');
    expect(HOOK).toContain('worktree remove --force');
    // Generated in the worktree: a link would point the tsconfig paths back at the working tree's sources.
    expect(HOOK).toContain('pnpm exec wxt prepare');
    // Never tested against dependencies the pushed commit does not pin.
    expect(HOOK).toContain('node_modules/.pnpm/lock.yaml');
  });

  it("never reaches the user's working tree or index: it reads the repository and manages its own worktree only", () => {
    expect(HOOK).toContain('unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE');
    expect(HOOK).toContain('-c core.hooksPath=/dev/null worktree add');
    // Every git command the script runs (comments aside), after git's own -C/-c/--option words: no stash, checkout,
    // reset, add or commit can ever reach the user's checkout.
    const code = HOOK.replace(/^\s*#.*$/gm, '');
    const commands = [...code.matchAll(/\bgit(?:\s+-[Cc]\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+([a-z-]+)/g)];
    expect(new Set(commands.map((match) => match[1]))).toEqual(
      new Set(['log', 'rev-parse', 'show', 'worktree']),
    );
    const worktree = [...code.matchAll(/\bworktree\s+([a-z]+)/g)].map((match) => match[1]);
    expect(new Set(worktree)).toEqual(new Set(['add', 'prune', 'remove']));
  });
});

/**
 * The hook run for real on a throwaway repository. The fake `pnpm` on PATH writes, for each `pnpm test`, the
 * directory it ran in and the `marker` file it found there, and fails when that tree holds a file named `broken`.
 * Every git variable of the surrounding run is dropped, so the sandbox never sees the real repository.
 */
const HOOK_SCRIPT = path.join(REPO, 'scripts/pre-push.sh');
const ZERO_SHA = '0'.repeat(40);
const LOCK = 'lockfileVersion: 9.0\n';
const FAKE_PNPM = String.raw`#!/usr/bin/env bash
case "$*" in
  'exec wxt prepare') mkdir -p .wxt ;;
  test) printf '%s %s\n' "$(pwd -P)" "$(cat marker)" >>"$PNPM_LOG"; [ ! -e broken ] ;;
  *) echo "unexpected: pnpm $*" >&2; exit 99 ;;
esac
`;

interface Sandbox {
  readonly root: string;
  readonly repo: string;
  /** TMPDIR of the hook: the temporary worktree goes here and must be gone afterwards. */
  readonly tmp: string;
  readonly log: string;
  readonly env: NodeJS.ProcessEnv;
}

const sandboxes: string[] = [];

function git(box: Sandbox, args: readonly string[], extra: NodeJS.ProcessEnv = {}, input?: string): string {
  const env = { ...box.env, ...extra };
  return execFileSync('git', args, { cwd: box.repo, env, input, encoding: 'utf8' }).trim();
}

/** Writes (or, for null, deletes) files in the sandbox checkout. */
function write(box: Sandbox, files: Readonly<Record<string, string | null>>): void {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(box.repo, name);
    if (content === null) rmSync(file, { force: true });
    else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
}

function commit(box: Sandbox, message: string, files: Readonly<Record<string, string | null>>): string {
  write(box, files);
  git(box, ['add', '-A']);
  git(box, ['commit', '-q', '--no-verify', '-m', message]);
  return git(box, ['rev-parse', 'HEAD']);
}

/** A repository whose one commit passes, with node_modules installed from that commit's lockfile. */
function sandbox(): { box: Sandbox; good: string } {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'attest-pre-push-spec-')));
  sandboxes.push(root);
  const at = (name: string) => path.join(root, name);
  const bin = at('bin');
  const outer = Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(outer),
    PATH: [bin, process.env.PATH ?? ''].join(path.delimiter),
    TMPDIR: at('tmp'),
    PNPM_LOG: at('pnpm.log'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Attest test',
    GIT_AUTHOR_EMAIL: 'test@attest.invalid',
    GIT_COMMITTER_NAME: 'Attest test',
    GIT_COMMITTER_EMAIL: 'test@attest.invalid',
  };
  const box = { root, repo: at('repo'), tmp: at('tmp'), log: at('pnpm.log'), env };
  for (const dir of [bin, box.repo, box.tmp]) mkdirSync(dir);
  writeFileSync(path.join(bin, 'pnpm'), FAKE_PNPM, { mode: 0o755 });
  git(box, ['init', '-q', '-b', 'main']);
  const files = {
    '.gitignore': 'node_modules/\n',
    'pnpm-lock.yaml': LOCK,
    'extension/a.ts': '',
    marker: 'good\n',
  };
  const good = commit(box, 'good', files);
  write(box, { 'node_modules/.pnpm/lock.yaml': LOCK, 'extension/node_modules/.keep': '' });
  return { box, good };
}

/** The user's checkout as the hook must leave it: files, index bytes, worktrees and the installed modules. */
function checkout(box: Sandbox): string {
  const quiet = { GIT_OPTIONAL_LOCKS: '0' };
  return [
    git(box, ['status', '--porcelain=v2', '-uall', '--ignored'], quiet),
    readFileSync(path.join(box.repo, '.git/index')).toString('base64'),
    git(box, ['worktree', 'list', '--porcelain'], quiet),
    readdirSync(path.join(box.repo, 'extension/node_modules')).join(','),
  ].join('\n');
}

/** Runs the hook as git does (a line per pushed ref on stdin) or by hand (`args`); `markers`: what pnpm tested. */
function push(
  box: Sandbox,
  lines: readonly string[],
  extra: NodeJS.ProcessEnv = {},
  args: readonly string[] = [],
) {
  writeFileSync(box.log, '');
  const before = checkout(box);
  const input = lines.map((line) => `${line}\n`).join('');
  const env = { ...box.env, ...extra };
  const run = spawnSync('bash', [HOOK_SCRIPT, ...args], { cwd: box.repo, env, input, encoding: 'utf8' });
  expect(checkout(box)).toBe(before);
  expect(readdirSync(box.tmp)).toEqual([]);
  const tested = readFileSync(box.log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
  for (const line of tested) expect(line.startsWith(`${box.tmp}/`), line).toBe(true);
  return {
    status: run.status,
    output: `${run.stdout}${run.stderr}`,
    markers: tested.map((l) => l.split(' ')[1]),
  };
}

const ref = (sha: string, name = 'refs/heads/main') => `${name} ${sha} ${name} ${ZERO_SHA}`;

describe('the pre-push hook on a throwaway repository: what it tests', () => {
  afterEach(() => {
    for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('tests the pushed commit in a temporary worktree: the working tree neither blocks nor passes it', () => {
    const { box, good } = sandbox();
    const broken = commit(box, 'broken', { broken: '', marker: 'broken\n' });
    write(box, { broken: null, marker: 'fixed\n' });
    const blocked = push(box, [ref(broken)]);
    expect(blocked.status).toBe(1);
    expect(blocked.markers).toEqual(['broken']);
    expect(blocked.output).toContain(`did not pass on commit ${broken.slice(0, 7)}`);
    expect(blocked.output).toContain('push blocked');

    write(box, { broken: '', marker: 'dirty\n', 'staged.txt': '' });
    git(box, ['add', 'staged.txt']);
    const passed = push(box, [ref(good)]);
    expect(passed.status).toBe(0);
    expect(passed.markers).toEqual(['good']);
    expect(passed.output).toContain(`pnpm test passed on commit ${good.slice(0, 7)} (good)`);
  });

  it('tests every pushed tip once, in order, and blocks the push when any fails', () => {
    const { box, good } = sandbox();
    git(box, ['tag', '-a', '-m', 'v1', 'v1', good]);
    const tag = git(box, ['rev-parse', 'v1']);
    const once = push(box, [
      ref(good),
      ref(tag, 'refs/tags/v1'),
      `(delete) ${ZERO_SHA} refs/heads/old ${good}`,
    ]);
    expect(once).toMatchObject({ status: 0, markers: ['good'] });
    const broken = commit(box, 'broken', { broken: '', marker: 'broken\n' });
    expect(push(box, [], {}, ['v1'])).toMatchObject({ status: 0, markers: ['good'] }); // by hand: not HEAD
    expect(push(box, [ref(good, 'refs/heads/a'), ref(broken, 'refs/heads/b')])).toMatchObject({
      status: 1,
      markers: ['good', 'broken'],
    });
    const deleted = push(box, [`(delete) ${ZERO_SHA} refs/heads/old ${good}`]);
    expect(deleted).toMatchObject({ status: 0, markers: [] });
    expect(deleted.output).toContain('nothing to test');
  });

  it("ignores the git variables of the push that would aim it at the user's index or working tree", () => {
    const { box, good } = sandbox();
    write(box, { broken: '', marker: 'dirty\n' });
    const gitDir = path.join(box.repo, '.git');
    const inherited = {
      GIT_DIR: gitDir,
      GIT_INDEX_FILE: path.join(gitDir, 'index'),
      GIT_WORK_TREE: box.repo,
    };
    expect(push(box, [ref(good)], inherited)).toMatchObject({ status: 0, markers: ['good'] });
  });
});

describe('the pre-push hook on a throwaway repository: what it refuses to test', () => {
  afterEach(() => {
    for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('stops before testing a commit whose lockfile differs from the one the modules were installed from', () => {
    const { box } = sandbox();
    const relocked = commit(box, 'relock', { 'pnpm-lock.yaml': `${LOCK}# another dependency\n` });
    const run = push(box, [ref(relocked)]);
    expect(run).toMatchObject({ status: 1, markers: [] });
    expect(run.output).toContain('pnpm-lock.yaml differs');
  });

  it('stops on a commit that tracks node_modules, without writing through it into the installed modules', () => {
    const { box, good } = sandbox();
    // A tracked symlink to the installed modules, committed through a scratch index (the checkout keeps its folder).
    const index = { GIT_INDEX_FILE: path.join(box.root, 'scratch-index') };
    git(box, ['read-tree', good], index);
    const target = path.join(box.repo, 'extension/node_modules');
    const blob = git(box, ['hash-object', '-w', '--stdin'], index, target);
    git(box, ['update-index', '--add', '--cacheinfo', `120000,${blob},extension/node_modules`], index);
    const tree = git(box, ['write-tree'], index);
    const linked = git(box, ['commit-tree', tree, '-p', good, '-m', 'tracks node_modules'], index);
    const run = push(box, [ref(linked)]);
    expect(run).toMatchObject({ status: 1, markers: [] });
    expect(run.output).toContain('tracks extension/node_modules');
    expect(readdirSync(target)).toEqual(['.keep']);
  });
});
