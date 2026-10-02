/**
 * pnpm attest replay <export.json>
 *
 * Node-side tooling (runs under tsx; not part of the extension). Reads a ledger export in the replay format
 * (attest-snapshot.ts documents it: the Sprint 0 LedgerExport plus `receiptInputs` and `policies`), replays every
 * stored receipt with src/core/replay.ts (docs/grading.md §9), and prints a summary: receipts, batches, how many were
 * reproduced, mismatches by field, and the first mismatches. Output holds ids, hashes, grades, rule ids, states,
 * numbers and timestamps only, never content (Hard Rules 2, 10).
 *
 * Exit codes: 0 every receipt reproduced; 1 at least one mismatch; 2 bad arguments or an unreadable export.
 *
 * Programmatic use (tests): `await main(['replay', file], io)`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPLAY_FIELDS, replay, type ReplayMismatch, type ReplayReport } from '../../src/core/replay';

import { readSnapshot, SnapshotError } from './attest-snapshot';

export const EXIT = { reproduced: 0, mismatch: 1, unusable: 2 } as const;

/** The most mismatches listed one per line; the rest are counted. */
export const LISTED_MISMATCHES = 20;

export const HELP = [
  'usage: pnpm attest replay <export.json>',
  '',
  '  Replays every receipt in a ledger export (docs/grading.md §9) and compares inputsHash, grade, ruleId,',
  '  state and every other field grading computed with what is stored, and checks that each observation',
  '  graded with still hashes to its contentHash. The export format is documented in',
  '  tests/tools/attest-snapshot.ts.',
  '',
  '  exit 0: every receipt reproduced; 1: at least one mismatch; 2: bad arguments or an unreadable export.',
].join('\n');

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const CONSOLE_IO: CliIo = {
  out: (line) => {
    console.log(line);
  },
  err: (line) => {
    console.error(line);
  },
};

function describeMismatch(one: ReplayMismatch): string {
  return `    ${one.receiptId} ${one.field}: stored ${one.stored ?? '(none)'}, replayed ${one.replayed ?? '(none)'}`;
}

/** The summary `attest replay` prints for a report. */
export function summarize(file: string, report: ReplayReport): string[] {
  const lines = [
    `attest replay ${file}`,
    `  receipts    ${String(report.receipts)} in ${String(report.batches)} batches`,
    `  reproduced  ${String(report.reproduced)}`,
    `  mismatched  ${String(report.mismatched)}`,
  ];
  if (report.mismatches.length === 0) return lines;
  const counts = REPLAY_FIELDS.filter((field) => report.byField[field] > 0).map(
    (field) => `${field} ${String(report.byField[field])}`,
  );
  const listed = report.mismatches.slice(0, LISTED_MISMATCHES);
  const total = report.mismatches.length;
  return [
    ...lines,
    `  by field    ${counts.join(', ')}`,
    `  mismatches (${String(listed.length)} of ${String(total)} listed):`,
    ...listed.map(describeMismatch),
  ];
}

async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'error';
    throw new SnapshotError('invalid_snapshot', `cannot read ${file} (${code})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SnapshotError('invalid_snapshot', `${file} is not JSON`);
  }
}

/** `attest replay <file>`: the exit code. A relative `file` is read from `cwd`. */
async function replayCommand(file: string, io: CliIo, cwd: string): Promise<number> {
  try {
    const snapshot = readSnapshot(await readJson(path.resolve(cwd, file)));
    const report = await replay(snapshot);
    for (const line of summarize(file, report)) io.out(line);
    return report.mismatched === 0 ? EXIT.reproduced : EXIT.mismatch;
  } catch (error) {
    if (!(error instanceof SnapshotError)) throw error;
    io.err(`attest replay failed [${error.code}]: ${error.message}`);
    return EXIT.unusable;
  }
}

/**
 * Runs the CLI; returns the exit code. `cwd` is where relative paths are read from: by default the directory
 * `pnpm attest` was typed in (pnpm's INIT_CWD; the script itself runs in extension/).
 */
export async function main(
  argv: readonly string[],
  io: CliIo = CONSOLE_IO,
  cwd: string = process.env.INIT_CWD ?? process.cwd(),
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    (command === undefined ? io.err : io.out)(HELP);
    return command === undefined ? EXIT.unusable : EXIT.reproduced;
  }
  const [file, ...extra] = rest;
  if (command !== 'replay' || file === undefined || extra.length > 0) {
    io.err(HELP);
    return EXIT.unusable;
  }
  return replayCommand(file, io, cwd);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
