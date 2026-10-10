/**
 * Records a model vendor's answers to the advisory model bench's inputs with the person's own key (sprint_5 5.5;
 * MANUAL.md, Sprint 5; bench/intel.ts reads the recording). Each input of
 * extension/entrypoints/model-check/bench-inputs.json is sent through the extension's own provider and call
 * (src/intel/providers/byo.ts; src/intel/index.ts `scoresFor`, with its 2-second limit), so the vendor receives
 * exactly what the extension would send, and every input is invented. The answers are written to
 * bench/fixtures/intel/byo-<vendor>.json: scores in basis points, or null where the vendor gave none in time; never a
 * hint, never an input. The key is read from a file the person names, checked for a key's shape, and printed nowhere:
 * the output names the file written and counts only.
 *
 * From extension/: `pnpm exec tsx ../bench/intel-record.ts --vendor anthropic --key-file <path to a file holding the key>`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ByoKey, ByoVendorName } from '../extension/src/bus/page-commands';
import { isoWithLocalOffset } from '../extension/src/clock';
import { BYO_VENDORS, type ByoVendor } from '../extension/src/config';
import type { IntelProvider } from '../extension/src/intel';
import { byoProvider } from '../extension/src/intel/providers/byo';
import {
  BENCH_INPUTS,
  type BenchAnswers,
  recordBench,
  recordingFile,
} from '../extension/entrypoints/model-check/record';
import { INTEL_FIXTURES } from './intel';

/** What a run was asked to do, or why it cannot run (never naming the key). */
export type RecordArgs =
  | { readonly ok: true; readonly vendor: ByoVendor; readonly keyFile: string }
  | { readonly ok: false; readonly why: string };

const USAGE = 'usage: tsx ../bench/intel-record.ts --vendor anthropic|openai --key-file <path>';

/** The run's arguments (header). */
export function recordArgs(argv: readonly string[]): RecordArgs {
  const value = (flag: string): string | undefined => argv[argv.indexOf(flag) + 1];
  const vendor = ByoVendorName.safeParse(argv.includes('--vendor') ? value('--vendor') : undefined);
  const keyFile = argv.includes('--key-file') ? value('--key-file') : undefined;
  if (!vendor.success) return { ok: false, why: `no vendor named, or not anthropic or openai. ${USAGE}` };
  if (keyFile === undefined || keyFile.startsWith('--'))
    return { ok: false, why: `no key file named. ${USAGE}` };
  return { ok: true, vendor: vendor.data, keyFile };
}

/** The key the file holds, or null when it holds none in a key's shape (src/bus/page-commands.ts `ByoKey`). */
export function keyFrom(text: string): string | null {
  const parsed = ByoKey.safeParse(text.trim());
  return parsed.success ? parsed.data : null;
}

/** The recording's file, as the bench reads it (extension/tests/unit/intel/corpus.ts `IntelRecording`). */
export function byoRecording(vendor: ByoVendor, answers: BenchAnswers, recordedAt: string): string {
  return recordingFile({
    note: `The answers of ${vendor}'s ${BYO_VENDORS[vendor].model} to the bench's inputs, recorded with a person's own key by bench/intel-record.ts. Scores only, in basis points; null where it gave none in time.`,
    provider: 'byo',
    model: BYO_VENDORS[vendor].model,
    recordedAt,
    answers,
  });
}

/** Asks `provider` about every bench input and writes the recording (header); resolves how many it answered. */
export async function recordByo(
  vendor: ByoVendor,
  provider: IntelProvider,
  write: (file: string, content: string) => void,
  recordedAt: () => string = () => isoWithLocalOffset(new Date()),
): Promise<{ readonly file: string; readonly answered: number; readonly asked: number }> {
  const answers = await recordBench(provider, () => undefined);
  const file = path.join(INTEL_FIXTURES, `byo-${vendor}.json`);
  write(file, byoRecording(vendor, answers, recordedAt()));
  const answered = Object.values(answers).filter((scores) => scores !== null).length;
  return { file, answered, asked: BENCH_INPUTS.length };
}

const invokedAs = process.argv[1];
if (invokedAs !== undefined && import.meta.url === pathToFileURL(path.resolve(invokedAs)).href) {
  const args = recordArgs(process.argv.slice(2));
  const key = args.ok ? keyFrom(readFileSync(args.keyFile, 'utf8')) : null;
  if (!args.ok) {
    console.log(args.why);
    process.exitCode = 2;
  } else if (key === null) {
    console.log(
      'The key file holds no key in a key’s shape (letters, digits, - and _, 20 to 300 characters).',
    );
    process.exitCode = 2;
  } else {
    const result = await recordByo(args.vendor, byoProvider(args.vendor, key), (file, content) => {
      writeFileSync(file, content);
    });
    const where = path.relative(path.dirname(fileURLToPath(import.meta.url)), result.file);
    console.log(`Recorded ${String(result.answered)} answers of ${String(result.asked)} to bench/${where}.`);
  }
}
