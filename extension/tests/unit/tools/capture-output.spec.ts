import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertWritable,
  fixtureTarget,
  type LabelEntry,
  loadSeeds,
  SEEDS_PATH,
  writeFixture,
} from '../../tools/capture-output';

const ENTRY: LabelEntry = {
  capturedAt: '2026-10-01',
  selectorsVersion: null,
  seededSecrets: ['a', 'b', 'c'],
  expected: [],
  notes: '',
};

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'attest-capture-output-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

describe('fixtureTarget', () => {
  it('lays out <root>/<vendor>/<date>/<name>.html beside labels.json', () => {
    expect(fixtureTarget('/r', 'muse', '2026-10-01', 'activity')).toEqual({
      dir: path.resolve('/r/muse/2026-10-01'),
      fileName: 'activity.html',
      htmlPath: path.resolve('/r/muse/2026-10-01/activity.html'),
      labelsPath: path.resolve('/r/muse/2026-10-01/labels.json'),
    });
  });
});

describe('writeFixture', () => {
  it('creates the folder, the fixture, and labels.json with the template entry', async () => {
    const target = fixtureTarget(root, 'muse', '2026-10-01', 'activity');
    await writeFixture(target, '<!DOCTYPE html>\n<html></html>\n', ENTRY, false);
    expect(await readFile(target.htmlPath, 'utf8')).toBe('<!DOCTYPE html>\n<html></html>\n');
    expect(await readJson(target.labelsPath)).toEqual({ 'activity.html': ENTRY });
    expect(await readFile(target.labelsPath, 'utf8')).toMatch(/\n$/);
  });

  it('adds an entry without touching existing ones, whatever their shape', async () => {
    const target = fixtureTarget(root, 'muse', '2026-10-01', 'second');
    await mkdir(target.dir, { recursive: true });
    const existing = {
      'first.html': { capturedAt: '2026-10-01', expected: [{ type: 'email.sent' }], custom: 1 },
    };
    await writeFile(target.labelsPath, JSON.stringify(existing));
    await writeFixture(target, '<html></html>', ENTRY, false);
    expect(await readJson(target.labelsPath)).toEqual({ ...existing, 'second.html': ENTRY });
  });

  it('refuses to overwrite an existing fixture or labels entry without force', async () => {
    const target = fixtureTarget(root, 'muse', '2026-10-01', 'activity');
    await writeFixture(target, 'one', ENTRY, false);
    await expect(writeFixture(target, 'two', ENTRY, false)).rejects.toMatchObject({ code: 'exists' });
    expect(await readFile(target.htmlPath, 'utf8')).toBe('one');

    const orphan = fixtureTarget(root, 'muse', '2026-10-01', 'orphan');
    await writeFile(orphan.labelsPath, JSON.stringify({ 'orphan.html': ENTRY }));
    await expect(assertWritable(orphan, false)).rejects.toMatchObject({ code: 'exists' });
  });

  it('overwrites the fixture and replaces only its own entry with force', async () => {
    const target = fixtureTarget(root, 'muse', '2026-10-01', 'activity');
    const other = fixtureTarget(root, 'muse', '2026-10-01', 'other');
    await writeFixture(other, 'other', ENTRY, false);
    await writeFixture(target, 'one', ENTRY, false);
    await writeFixture(target, 'two', { ...ENTRY, seededSecrets: ['x', 'y', 'z'] }, true);
    expect(await readFile(target.htmlPath, 'utf8')).toBe('two');
    expect(await readJson(target.labelsPath)).toEqual({
      'other.html': ENTRY,
      'activity.html': { ...ENTRY, seededSecrets: ['x', 'y', 'z'] },
    });
  });
});

describe('writeFixture: what it refuses', () => {
  it('refuses a corrupt labels.json instead of clobbering it', async () => {
    const target = fixtureTarget(root, 'muse', '2026-10-01', 'activity');
    await mkdir(target.dir, { recursive: true });
    await writeFile(target.labelsPath, '{ not json');
    await expect(writeFixture(target, 'x', ENTRY, false)).rejects.toMatchObject({ code: 'bad_labels' });
    await writeFile(target.labelsPath, '["an", "array"]');
    await expect(writeFixture(target, 'x', ENTRY, true)).rejects.toMatchObject({ code: 'bad_labels' });
    expect(await readFile(target.labelsPath, 'utf8')).toBe('["an", "array"]');
  });

  it('reports a labels.json write failure as a typed io_failed error', async () => {
    const target = fixtureTarget(root, 'muse', '2026-10-01', 'activity');
    // A directory where the temporary labels file goes makes the write fail (EISDIR).
    await mkdir(`${target.labelsPath}.${process.pid}.tmp`, { recursive: true });
    await expect(writeFixture(target, 'x', ENTRY, false)).rejects.toMatchObject({ code: 'io_failed' });
  });

  it('rejects a malformed entry before writing anything', async () => {
    const target = fixtureTarget(root, 'muse', '2026-10-01', 'activity');
    const bad = { ...ENTRY, capturedAt: '01/10/2026' };
    await expect(writeFixture(target, 'x', bad, false)).rejects.toThrow();
    await expect(readFile(target.htmlPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('loadSeeds', () => {
  it('reads the committed seeds file', async () => {
    const seeds = await loadSeeds(SEEDS_PATH);
    expect(seeds.length).toBeGreaterThanOrEqual(3);
    for (const seed of seeds) expect(seed.id).toMatch(/^[a-z0-9_]+$/);
  });

  it.each([
    ['missing file', null],
    ['invalid JSON', '{'],
    ['wrong shape', JSON.stringify({ seeds: [{ id: 'Bad Id', value: 'x' }] })],
    [
      'duplicate ids',
      JSON.stringify({
        seeds: [
          { id: 'a', value: 'x' },
          { id: 'a', value: 'y' },
        ],
      }),
    ],
    ['no seeds', JSON.stringify({ seeds: [] })],
  ])('rejects %s with CaptureError(bad_seeds)', async (_label, content) => {
    const file = path.join(root, 'seeded.json');
    if (content !== null) await writeFile(file, content);
    await expect(loadSeeds(file)).rejects.toMatchObject({ code: 'bad_seeds' });
  });
});
