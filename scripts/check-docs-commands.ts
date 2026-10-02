/**
 * `pnpm …` invocations quoted in docs, for scripts/check-docs.ts. A command counts as quoted when it is in
 * code: an inline code span or a fenced block. Each invocation names either one of pnpm's own commands
 * (`install`, `exec`, …), which needs no script, or a package script (`pnpm test`, `pnpm run test`,
 * `pnpm --dir extension run test`), which must exist.
 */

/** pnpm's own commands. `run` and `run-script` take a script name; `test` and `start` run scripts. */
const PNPM_COMMANDS = new Set([
  'add',
  'approve-builds',
  'audit',
  'bin',
  'cache',
  'config',
  'create',
  'dedupe',
  'deploy',
  'dlx',
  'doctor',
  'env',
  'exec',
  'fetch',
  'help',
  'i',
  'ignored-builds',
  'import',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'ls',
  'outdated',
  'pack',
  'patch',
  'patch-commit',
  'prune',
  'publish',
  'rebuild',
  'remove',
  'rm',
  'root',
  'self-update',
  'setup',
  'store',
  'unlink',
  'update',
  'up',
  'why',
]);

const RUN_COMMANDS = new Set(['run', 'run-script']);

/** Global options that take a value as the next word. */
const OPTIONS_WITH_VALUE = new Set(['--dir', '-C', '--filter', '-F', '--reporter', '--loglevel']);

/** `pnpm` as a command word (not `pnpm-lock.yaml`, not a path ending in pnpm), up to a shell separator. */
const INVOCATION = /(?<![\w./-])pnpm[ \t]+([^\n;&|]*)/g;

/** One quoted `pnpm` invocation and the script it needs, if any. */
export interface PnpmInvocation {
  /** The invocation as written, from `pnpm` to the end of the command. */
  readonly text: string;
  /** The package script it runs, or null for pnpm's own commands. */
  readonly script: string | null;
}

/** The words after `pnpm`, skipping global options (and their values) until the command word. */
function commandWords(words: readonly string[]): string[] {
  const rest = [...words];
  while (rest.length > 0) {
    const word = rest[0] ?? '';
    if (OPTIONS_WITH_VALUE.has(word)) rest.splice(0, 2);
    else if (word.startsWith('-')) rest.splice(0, 1);
    else break;
  }
  return rest;
}

/** The script a `pnpm` invocation runs, or null when it runs one of pnpm's own commands (or nothing). */
export function scriptOf(argumentsText: string): string | null {
  const words = commandWords(
    argumentsText
      .trim()
      .split(/\s+/)
      .filter((word) => word !== ''),
  );
  const command = words[0];
  if (command === undefined || command.startsWith('#')) return null;
  if (RUN_COMMANDS.has(command)) {
    const script = commandWords(words.slice(1))[0];
    return script ?? null;
  }
  return PNPM_COMMANDS.has(command) ? null : command;
}

/** Every `pnpm` invocation in a piece of code. */
export function pnpmInvocations(code: string): PnpmInvocation[] {
  return [...code.matchAll(INVOCATION)].map((match) => ({
    text: match[0].trim(),
    script: scriptOf(match[1] ?? ''),
  }));
}
