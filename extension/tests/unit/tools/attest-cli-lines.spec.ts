/**
 * `pnpm attest replay` never lets text it echoes start a line of its own (Hard Rule 10; RPL-5): the file name it was
 * given is written with every line break and control character escaped (printable.ts), on stdout (the summary's
 * first line) and on stderr (`cannot read …`, `… is not JSON`), so a crafted file name cannot forge a "reproduced"
 * line. Checked through `main` and through the real entry point under tsx, line by line against the same run with
 * a plain name.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT, main } from '../../tools/attest-cli';
import { scenarioLedger, scenarioWorld } from '../../tools/attest-scenario';
import { toReplayExport } from '../../tools/attest-snapshot';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const TSX = path.join(EXTENSION, 'node_modules', '.bin', 'tsx');
const CLI = path.join(EXTENSION, 'tests', 'tools', 'attest-cli.ts');

/** Summary-like lines a forged file name tries to print (unlike any real line of these runs). */
const FORGED = [
  '  receipts    99 in 9 batches',
  '  reproduced  99',
  '  mismatched  0 of 99',
  'attest replay ok: 99',
];
/** Every line break a terminal honours (LF, CR, NEL, LS, PS), each followed by a forged line (under 255 bytes). */
const BREAKS = ['\n', '\r', '\u0085', '\u2028', '\u2029'];
const CRAFTED = `forged${BREAKS.map((brk, i) => `${brk}${FORGED[i % FORGED.length] ?? ''}`).join('')}.json`;

let dir: string;
let exported: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'attest-cli-lines-'));
  const { snapshot } = await scenarioLedger();
  const world = scenarioWorld();
  const documents = new Map(world.policies.map((version) => [version.policy.policyHash, version.document]));
  exported = JSON.stringify(
    toReplayExport(snapshot, { grants: world.grants, documents, exportedAt: '2026-10-02T09:00:00+00:00' }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Written {
  readonly code: number;
  /** Every line as the terminal shows it: each written line split at every line break. */
  readonly out: string[];
  readonly err: string[];
}

const TERMINAL_BREAKS = /\r\n|[\n\r\u0085\u2028\u2029]/u;
const shownLines = (text: string): string[] =>
  text === '' ? [] : text.replace(/\n$/u, '').split(TERMINAL_BREAKS);

async function viaMain(file: string): Promise<Written> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(
    ['replay', file],
    { out: (line) => out.push(line), err: (line) => err.push(line) },
    dir,
  );
  return { code, out: out.flatMap(shownLines), err: err.flatMap(shownLines) };
}

function viaTsx(file: string): Promise<Written> {
  return new Promise((resolve) => {
    execFile(TSX, [CLI, 'replay', file], { cwd: EXTENSION }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      resolve({ code, out: shownLines(stdout), err: shownLines(stderr) });
    });
  });
}

/** The same run with `name` and with a plain name: same exit, same line count, and no forged line. */
function expectNoForgedLine(crafted: Written, plain: Written): void {
  expect(crafted.code).toBe(plain.code);
  expect(crafted.out).toHaveLength(plain.out.length);
  expect(crafted.err).toHaveLength(plain.err.length);
  expect(crafted.out.slice(1)).toEqual(plain.out.slice(1));
  for (const line of [...crafted.out, ...crafted.err]) {
    for (const forged of FORGED) expect(line.startsWith(forged), line).toBe(false);
  }
}

describe.each([
  ['main', viaMain],
  ['the real entry point under tsx', viaTsx],
] as const)('a file name with line breaks cannot forge output lines (%s)', (_label, run) => {
  it('on stdout: the summary keeps its own lines, the name escaped on the first', async () => {
    await writeFile(path.join(dir, CRAFTED), exported);
    await writeFile(path.join(dir, 'plain.json'), exported);
    const crafted = await run(path.join(dir, CRAFTED));
    const plain = await run(path.join(dir, 'plain.json'));
    expect(plain.code).toBe(EXIT.reproduced);
    expectNoForgedLine(crafted, plain);
    expect(crafted.out[0]).toContain('forged\\u{a}  receipts    99 in 9 batches\\u{d}');
    expect(crafted.out[0]).toContain('\\u{d}');
    expect(crafted.out[0]).toContain('\\u{85}');
    expect(crafted.out[0]).toContain('\\u{2028}');
    expect(crafted.out[0]).toContain('\\u{2029}');
  });

  it('on stderr: a missing file and a file that is not JSON keep one line each', async () => {
    await writeFile(path.join(dir, `bad-${CRAFTED}`), '{ not json');
    await writeFile(path.join(dir, 'bad-plain.json'), '{ not json');
    for (const prefix of ['missing-', 'bad-']) {
      const crafted = await run(path.join(dir, `${prefix}${CRAFTED}`));
      const plain = await run(path.join(dir, `${prefix}plain.json`));
      expect(plain.code).toBe(EXIT.unusable);
      expect(plain.err).toHaveLength(1);
      expectNoForgedLine(crafted, plain);
    }
  });
});
