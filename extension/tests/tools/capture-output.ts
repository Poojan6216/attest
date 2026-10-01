/**
 * Where a captured fixture goes, and the labels.json beside it.
 *
 * tests/fixtures/pages/<vendor>/<yyyy-mm-dd>/<name>.html + labels.json. labels.json is created when missing;
 * otherwise this fixture's entry is added and every other entry is left exactly as it was. An existing fixture
 * or entry is never overwritten without --force.
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { CaptureError, hasErrorCode } from './capture-error';
import type { SeedSecret } from './sanitize';
import { BaseSeed, uniqueIds } from './seeds';

export { SEEDS_PATH } from './seeds';

/** Lenient on purpose: `--seeds <path>` may point at any file of seeds, not only the mandatory set. */
const SeedFileSchema = z.object({
  seeds: z.array(BaseSeed).min(1).refine(uniqueIds, 'seed ids must be unique'),
});

/** One fixture's entry in labels.json. `expected` is filled in by hand when the adapter is written. */
export const LabelEntrySchema = z.strictObject({
  capturedAt: z.iso.date(),
  selectorsVersion: z.union([z.string(), z.number()]).nullable(),
  seededSecrets: z.array(z.string().min(1)),
  expected: z.array(z.unknown()),
  notes: z.string(),
});

export type LabelEntry = z.infer<typeof LabelEntrySchema>;

/** Other entries are kept verbatim, whatever their shape. */
const LabelsFileSchema = z.record(z.string(), z.unknown());

export interface FixtureTarget {
  readonly dir: string;
  readonly fileName: string;
  readonly htmlPath: string;
  readonly labelsPath: string;
}

export function fixtureTarget(outRoot: string, vendor: string, date: string, name: string): FixtureTarget {
  const dir = path.resolve(outRoot, vendor, date);
  const fileName = `${name}.html`;
  return { dir, fileName, htmlPath: path.join(dir, fileName), labelsPath: path.join(dir, 'labels.json') };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw new CaptureError(
      'io_failed',
      `Cannot check ${filePath}: ${error instanceof Error ? error.name : 'error'}.`,
    );
  }
}

export async function loadSeeds(seedsPath: string): Promise<SeedSecret[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(seedsPath, 'utf8'));
  } catch (error) {
    throw new CaptureError(
      'bad_seeds',
      `Cannot read seeds at ${seedsPath}: ${error instanceof Error ? error.name : 'error'}.`,
    );
  }
  const parsed = SeedFileSchema.safeParse(raw);
  if (!parsed.success) throw new CaptureError('bad_seeds', `Seeds at ${seedsPath} do not match the schema.`);
  return parsed.data.seeds;
}

async function readLabels(labelsPath: string): Promise<Record<string, unknown>> {
  if (!(await exists(labelsPath))) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(labelsPath, 'utf8'));
  } catch (error) {
    throw new CaptureError(
      'bad_labels',
      `${labelsPath} is not valid JSON (${error instanceof Error ? error.name : 'error'}); fix it by hand.`,
    );
  }
  const parsed = LabelsFileSchema.safeParse(raw);
  if (!parsed.success)
    throw new CaptureError('bad_labels', `${labelsPath} must be a JSON object keyed by fixture file.`);
  return parsed.data;
}

/** Refuses (before anything is captured) when the fixture or its labels entry exists and force is off. */
export async function assertWritable(target: FixtureTarget, force: boolean): Promise<void> {
  if (force) return;
  if (await exists(target.htmlPath)) {
    throw new CaptureError(
      'exists',
      `${target.htmlPath} already exists. Pick another --name or pass --force.`,
    );
  }
  const labels = await readLabels(target.labelsPath);
  if (Object.hasOwn(labels, target.fileName)) {
    throw new CaptureError(
      'exists',
      `${target.labelsPath} already has an entry for ${target.fileName}. Pass --force to replace it.`,
    );
  }
}

export async function writeFixture(
  target: FixtureTarget,
  html: string,
  entry: LabelEntry,
  force: boolean,
): Promise<void> {
  const checked = LabelEntrySchema.parse(entry);
  await assertWritable(target, force);
  const labels = await readLabels(target.labelsPath);
  await mkdir(target.dir, { recursive: true });
  try {
    await writeFile(target.htmlPath, html, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new CaptureError(
        'exists',
        `${target.htmlPath} appeared while capturing. Pass --force to overwrite.`,
      );
    }
    throw new CaptureError(
      'io_failed',
      `Cannot write ${target.htmlPath}: ${error instanceof Error ? error.name : 'error'}.`,
    );
  }
  const next = { ...labels, [target.fileName]: checked };
  const temporary = `${target.labelsPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, target.labelsPath);
  } catch (error) {
    throw new CaptureError(
      'io_failed',
      `Wrote ${target.htmlPath} but not ${target.labelsPath} (${error instanceof Error ? error.name : 'error'}); ` +
        'add its entry by hand or re-run with --force.',
    );
  }
}
