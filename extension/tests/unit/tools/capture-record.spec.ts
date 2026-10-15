/**
 * Where a re-fake writes its record (tests/tools/capture-record.ts; Sprint 7 security re-run, SEC-R1): never inside the
 * repository, whatever the path looks like (a `..name` at the root, the root in another letter case, a symbolic link to
 * it), and owner-only even over a file that was there before.
 */
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { isInside, REPOSITORY, writeRecord } from '../../tools/capture-record';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'attest-record-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('isInside', () => {
  it('reads every way of naming the repository as inside it', () => {
    const link = path.join(scratch, 'repo-link');
    symlinkSync(REPOSITORY, link);
    for (const inside of [
      REPOSITORY,
      path.join(REPOSITORY, 'extension', 'tests', 'record.json'),
      path.join(REPOSITORY, '..people.json'),
      path.join(REPOSITORY.toUpperCase(), 'record.json'),
      path.join(link, 'record.json'),
      path.join(link, 'not', 'there', 'yet.json'),
    ])
      expect(isInside(REPOSITORY, inside), inside).toBe(true);
  });

  it('reads a folder beside it, or anywhere else, as outside', () => {
    for (const outside of [
      path.join(scratch, 'record.json'),
      path.join(REPOSITORY, '..', 'attest-records', 'record.json'),
      path.join(os.tmpdir(), 'not', 'there', 'record.json'),
    ])
      expect(isInside(REPOSITORY, outside), outside).toBe(false);
  });
});

describe('writeRecord', () => {
  it('leaves the record owner-only, also over a file anyone could read', async () => {
    const file = path.join(scratch, 'record.json');
    writeFileSync(file, '[]\n', { mode: 0o644 });
    await writeRecord(file, '[{"kind":"amount"}]\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
