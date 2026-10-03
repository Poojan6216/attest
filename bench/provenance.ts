/**
 * What every bench result records about where it was measured (TECH-R12, Hard Rule 12): the git commit of the
 * code, whether the working tree differed from it, and the Node version. A number without these cannot be tied
 * to the code it describes.
 *
 * The dirty flag ignores the bench's own outputs (bench/results/, RESULTS.md), which a previous run may have left
 * modified: it describes the measured code. Without git (a source archive), the commit is 'unknown' and the tree
 * counts as dirty, since nothing shows it is clean.
 */
import { execFileSync } from 'node:child_process';

/** Runs git with `args` and returns its stdout; throws when git is missing or fails. */
export type Git = (args: readonly string[]) => string;

export interface Provenance {
  readonly commit: string;
  readonly commitDirty: boolean;
  readonly node: string;
}

export const UNKNOWN_COMMIT = 'unknown';
/** SHA-1 (40 hex) or SHA-256 (64 hex) object names. */
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Git in `cwd`, its stderr discarded. */
export function gitIn(cwd: string): Git {
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** The commit, dirty flag and Node version for a result measured now. */
export function provenance(git: Git, node: string = process.version): Provenance {
  let commit: string;
  let status: string;
  try {
    commit = git(['rev-parse', 'HEAD']).trim();
    status = git(['status', '--porcelain', '--', '.', ':(exclude)bench/results', ':(exclude)RESULTS.md']);
  } catch {
    return { commit: UNKNOWN_COMMIT, commitDirty: true, node };
  }
  if (!SHA.test(commit)) return { commit: UNKNOWN_COMMIT, commitDirty: true, node };
  return { commit, commitDirty: status.trim() !== '', node };
}
