/**
 * The popup bench's committed trace with no machine's paths in it (sprint_4 close; security review checklist "log.ts
 * only, no PII": the trace recorded the build's and the test profile's absolute paths, the home folder among them).
 * The trace holds no page data (synthetic receipts, no network, no snapshot); only its paths named the machine. Each
 * place is written as a placeholder: the repository as `<repo>`, the temporary folder as `<tmp>` (in both the forms
 * macOS gives it), and the home folder as `~`, longest first, so the repository inside the home folder is `<repo>`.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A place on this machine and what the trace says instead. */
export interface Place {
  readonly path: string;
  readonly as: string;
}

/** `text` with every place written as its placeholder, the longest place first. */
export function scrubPaths(text: string, places: readonly Place[]): string {
  const longestFirst = [...places]
    .filter(({ path: at }) => at.length > 1)
    .sort((a, b) => b.path.length - a.path.length);
  return longestFirst.reduce((scrubbed, { path: at, as }) => scrubbed.split(at).join(as), text);
}

/** The places of this machine a trace may name: the repository, the temporary folder (both forms) and the home folder. */
export function machinePlaces(repoRoot: string): Place[] {
  const tmp = os.tmpdir();
  return [
    { path: repoRoot, as: '<repo>' },
    { path: realpathSync(tmp), as: '<tmp>' },
    { path: tmp, as: '<tmp>' },
    { path: os.homedir(), as: '~' },
  ];
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

/**
 * Rewrites the zip at `zipPath` with every text file scrubbed (`scrubPaths`), through the system's `unzip` and `zip`;
 * throws when the scrubbed trace still names the home folder, so a trace that names the machine is never committed.
 */
export function scrubTrace(zipPath: string, places: readonly Place[]): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-trace-'));
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', dir]);
    for (const file of files(dir)) {
      const bytes = readFileSync(file);
      if (bytes.includes(0)) continue;
      writeFileSync(file, scrubPaths(bytes.toString('utf8'), places));
    }
    rmSync(zipPath);
    execFileSync('zip', ['-q', '-X', '-r', zipPath, '.'], { cwd: dir });
    const named = files(dir).filter((file) => readFileSync(file).includes(os.homedir()));
    if (named.length > 0)
      throw new Error(`the trace still names the home folder in ${String(named.length)} file(s)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
