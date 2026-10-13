/**
 * Source maps (sprint_7 7.0; Decisions [7.0]: every build keeps them, so CI's build artifact and the store zip hold
 * them and the code stays readable for store review; QA review, sprint 7): every script the build ships has its map
 * beside it, and no map names a path of the machine that built it, in its sources or their content, so the store zip
 * carries no one's home folder. Reads the build `pnpm e2e` makes; no browser.
 */
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { EXTENSION_PATH } from './support/extension';

/** Every file under `dir`. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

const relative = (file: string): string => path.relative(EXTENSION_PATH, file);

test('every shipped script has its source map, and no map names a path of this machine', () => {
  const all = files(EXTENSION_PATH);
  const scripts = all.filter((file) => file.endsWith('.js'));
  expect(scripts.length).toBeGreaterThan(5);
  expect(scripts.filter((file) => !all.includes(`${file}.map`)).map(relative)).toEqual([]);
  const repository = path.resolve(import.meta.dirname, '../../..');
  const home = os.homedir();
  const naming = all
    .filter((file) => file.endsWith('.map'))
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      const map = JSON.parse(text) as { sources?: unknown };
      const sources = Array.isArray(map.sources) ? map.sources.map(String) : [];
      return (
        sources.length === 0 ||
        sources.some((source) => path.isAbsolute(source)) ||
        text.includes(repository) ||
        text.includes(home)
      );
    });
  expect(naming.map(relative)).toEqual([]);
});
