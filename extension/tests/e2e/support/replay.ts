/**
 * `pnpm attest replay` over a ledger export the extension made (docs/grading.md §9; the Sprint 3 Gate "replay over the
 * E2E ledger reproduces every receipt"; QA review GAP 4): the export written as the file the options page saves, the
 * replay CLI run on it, its summary returned. The CLI exits non-zero when a receipt differs, so a mismatch throws here.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LedgerExport } from '../../../src/ledger/export';

const EXTENSION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The summary lines `pnpm attest replay` prints for `ledger`. */
export function replayExport(ledger: LedgerExport): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-replay-'));
  try {
    const file = path.join(dir, 'attest-ledger.json');
    writeFileSync(file, JSON.stringify(ledger));
    return execFileSync('pnpm', ['--silent', 'attest', 'replay', file], {
      cwd: EXTENSION_ROOT,
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The summary lines `pnpm attest replay` prints for the export the options page saved at `file`. */
export function replayFile(file: string): string {
  return execFileSync('pnpm', ['--silent', 'attest', 'replay', file], {
    cwd: EXTENSION_ROOT,
    encoding: 'utf8',
  });
}
