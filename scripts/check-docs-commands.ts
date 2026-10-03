/**
 * `pnpm …` invocations quoted in docs, for scripts/check-docs.ts. A command counts as quoted when it is in
 * code: an inline code span, or a fenced or indented code block. Each invocation names either one of pnpm's own
 * commands (`install`, `exec`, …), which needs no script, or a package script (`pnpm test`, `pnpm run test`,
 * `pnpm --dir extension run test`), which must exist in the package the command runs in (QA-G10): the repo root
 * unless a `cd` before it, `-C`/`--dir`, `--filter`/`-F`, `-w` or a recursive run (`-r`, `pnpm recursive …`)
 * says otherwise.
 */

/** pnpm's own commands (and their aliases), and the npm commands pnpm passes through: none runs a script. */
const PNPM_COMMANDS = new Set([
  ...['add', 'approve-builds', 'audit', 'bin', 'cache', 'c', 'cat-file', 'cat-index', 'completion', 'config'],
  ...['create', 'dedupe', 'deploy', 'dislink', 'dlx', 'doctor', 'env', 'exec', 'fetch', 'find-hash', 'help'],
  ...['i', 'ignored-builds', 'import', 'init', 'install', 'install-test', 'it', 'licenses', 'link', 'list'],
  ...['ll', 'ln', 'ls', 'outdated', 'pack', 'patch', 'patch-commit', 'patch-remove', 'prune', 'publish'],
  ...['rb', 'rebuild', 'remove', 'rm', 'root', 'self-update', 'server', 'setup', 'store', 'un', 'uni'],
  ...['uninstall', 'unlink', 'update', 'up', 'upgrade', 'why'],
  // npm commands pnpm passes through to npm.
  ...['access', 'adduser', 'bugs', 'deprecate', 'dist-tag', 'docs', 'edit', 'info', 'login', 'logout'],
  ...['owner', 'ping', 'pkg', 'prefix', 'profile', 'repo', 's', 'se', 'search', 'set-script', 'show', 'star'],
  ...['stars', 'team', 'token', 'unpublish', 'unstar', 'v', 'version', 'view', 'whoami', 'xmas'],
]);

const RUN_COMMANDS = new Set(['run', 'run-script']);
/** `pnpm recursive <command>` and its aliases run the command in every workspace package. */
const RECURSIVE_COMMANDS = new Set(['recursive', 'multi', 'm']);
/** Aliases of `pnpm test`, which runs the `test` script. */
const TEST_ALIASES = new Set(['t', 'tst']);

/** Global options that take a value as the next word (or after `=`). */
const OPTIONS_WITH_VALUE = new Set(['--dir', '-C', '--filter', '-F', '--reporter', '--loglevel']);

/** `pnpm` as a command word (not `pnpm-lock.yaml`, not a path ending in pnpm), up to a shell separator. */
const INVOCATION = /(?<![\w./-])pnpm[ \t]+([^\n;&|()]*)/g;
/** Where one shell command ends and the next begins. */
const SEPARATOR = /&&|\|\||[;&|()\n]/;
/** A shell comment: `#` at the start of a word, to the end of the line. */
const SHELL_COMMENT = /(^|[ \t])#[^\n]*/g;

/**
 * Which package's scripts an invocation runs: the package in `dir` (a directory relative to the repo root, '.'
 * for the root), the packages a `--filter` selector picks, every workspace package (recursive), or unknown (a
 * `cd` or `--dir` that leaves the repository, or goes somewhere a doc cannot know, such as `~`).
 */
export type PnpmTarget =
  | { readonly kind: 'dir'; readonly dir: string }
  | { readonly kind: 'filter'; readonly selector: string; readonly dir: string }
  | { readonly kind: 'recursive'; readonly includeRoot: boolean }
  | { readonly kind: 'unknown'; readonly reason: string };

/** One quoted `pnpm` invocation, the script it needs (null for pnpm's own commands), and where it runs. */
export interface PnpmInvocation {
  /** The invocation as written, from `pnpm` to the end of the command. */
  readonly text: string;
  readonly script: string | null;
  readonly target: PnpmTarget;
}

interface Options {
  dir: string | null;
  filter: string | null;
  recursive: boolean;
  workspaceRoot: boolean;
  includeRoot: boolean;
}

/** A shell word without its surrounding quotes. */
const unquote = (word: string): string => word.replace(/^(["'])(.*)\1$/, '$2');

function setOption(options: Options, flag: string, raw: string | undefined): void {
  const value = raw === undefined ? null : unquote(raw);
  if (flag === '--dir' || flag === '-C') options.dir = value;
  if (flag === '--filter' || flag === '-F') options.filter = value;
  if (flag === '-r' || flag === '--recursive') options.recursive = true;
  if (flag === '-w' || flag === '--workspace-root') options.workspaceRoot = true;
  if (flag === '--include-workspace-root') options.includeRoot = true;
}

/** Reads global options (and their values) off the front of `words`, until the command word. */
function takeOptions(words: readonly string[], options: Options): string[] {
  const rest = [...words];
  while (rest.length > 0) {
    const word = rest[0] ?? '';
    if (!word.startsWith('-')) break;
    const equals = word.startsWith('--') ? word.indexOf('=') : -1;
    const flag = equals === -1 ? word : word.slice(0, equals);
    const inline = equals === -1 ? undefined : word.slice(equals + 1);
    const takesValue = OPTIONS_WITH_VALUE.has(flag) && inline === undefined;
    setOption(options, flag, takesValue ? rest[1] : inline);
    rest.splice(0, takesValue ? 2 : 1);
  }
  return rest;
}

/** The script a pnpm command line runs (null for pnpm's own commands, or nothing), and its options. */
function parse(argumentsText: string): { script: string | null; options: Options } {
  const options: Options = {
    dir: null,
    filter: null,
    recursive: false,
    workspaceRoot: false,
    includeRoot: false,
  };
  let words = takeOptions(argumentsText.trim().split(/\s+/).filter(Boolean), options);
  if (RECURSIVE_COMMANDS.has(words[0] ?? '')) {
    options.recursive = true;
    words = takeOptions(words.slice(1), options);
  }
  const command = words[0];
  if (command === undefined) return { script: null, options };
  if (RUN_COMMANDS.has(command)) return { script: takeOptions(words.slice(1), options)[0] ?? null, options };
  if (TEST_ALIASES.has(command)) return { script: 'test', options };
  return { script: PNPM_COMMANDS.has(command) ? null : command, options };
}

/** The script a `pnpm` invocation runs, or null when it runs one of pnpm's own commands (or nothing). */
export function scriptOf(argumentsText: string): string | null {
  return parse(argumentsText).script;
}

/** `dir` joined with a relative `path` ('/' separated), or null when it leaves the repository root. */
function joinDir(dir: string, relative: string): string | null {
  const parts = dir === '.' ? [] : dir.split('/');
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.pop() === undefined) return null;
  }
  return parts.length === 0 ? '.' : parts.join('/');
}

/** The working directory after `cd <argument>`, or null when a doc cannot know it (`cd`, `cd ~`, `cd /x`, …). */
function changeDir(cwd: string | null, argument: string | undefined): string | null {
  if (cwd === null || argument === undefined) return null;
  const dir = unquote(argument);
  return /^[~/$-]/.test(dir) ? null : joinDir(cwd, dir);
}

function targetOf(options: Options, cwd: string | null): PnpmTarget {
  if (cwd === null) return { kind: 'unknown', reason: 'it runs after a cd that leaves the repository' };
  if (options.workspaceRoot) return { kind: 'dir', dir: '.' };
  const dir = options.dir === null ? cwd : changeDir(cwd, options.dir);
  if (dir === null) return { kind: 'unknown', reason: `--dir '${options.dir ?? ''}' leaves the repository` };
  if (options.filter !== null) return { kind: 'filter', selector: options.filter, dir };
  if (options.recursive) return { kind: 'recursive', includeRoot: options.includeRoot };
  return { kind: 'dir', dir };
}

/** Walks the shell commands in `code` from `cwd`: every `pnpm` invocation, and the working directory after. */
function walkShell(code: string, cwd: string | null): { invocations: PnpmInvocation[]; cwd: string | null } {
  const invocations: PnpmInvocation[] = [];
  let dir = cwd;
  for (const command of code.replace(SHELL_COMMENT, '$1').split(SEPARATOR)) {
    const words = command.trim().split(/\s+/);
    if (words[0] === 'cd') {
      dir = changeDir(dir, words[1]);
      continue;
    }
    for (const match of command.matchAll(INVOCATION)) {
      const { script, options } = parse(match[1] ?? '');
      invocations.push({ text: match[0].trim(), script, target: targetOf(options, dir) });
    }
  }
  return { invocations, cwd: dir };
}

/** Every `pnpm` invocation in a piece of code run from `cwd` (the repo root, unless its code block moved). */
export function pnpmInvocations(code: string, cwd: string | null = '.'): PnpmInvocation[] {
  return walkShell(code, cwd).invocations;
}

/** The working directory after `code` runs from `cwd` (null when unknown), for the next line of a code block. */
export function cwdAfter(code: string, cwd: string | null): string | null {
  return walkShell(code, cwd).cwd;
}
