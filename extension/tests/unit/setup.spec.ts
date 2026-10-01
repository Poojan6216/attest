/**
 * src/setup.ts must run before any Zod schema is built in every extension context, or Zod's eval
 * probe trips the CSP (Hard Rule 9) and logs a console error. ES modules evaluate in import order,
 * so "first import of every entrypoint" is the guarantee; this test enforces it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTRYPOINTS = path.join(ROOT, 'entrypoints');

function entrypointFiles(): string[] {
  const files: string[] = [];
  for (const name of readdirSync(ENTRYPOINTS)) {
    const full = path.join(ENTRYPOINTS, name);
    if (statSync(full).isDirectory()) {
      for (const candidate of ['main.tsx', 'main.ts', 'index.ts']) {
        const file = path.join(full, candidate);
        try {
          if (statSync(file).isFile()) files.push(file);
        } catch {
          // not every directory entrypoint has every candidate file
          continue;
        }
      }
      if (name === 'content') {
        for (const script of readdirSync(full))
          if (script.endsWith('.content.ts')) files.push(path.join(full, script));
      }
    } else if (/\.(content\.)?tsx?$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

function firstImport(source: string): string | undefined {
  return /^\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/m.exec(source)?.[1];
}

describe('runtime setup', () => {
  it('is the first import of every entrypoint', () => {
    const files = entrypointFiles();
    expect(files.map((f) => path.relative(ENTRYPOINTS, f)).sort()).toEqual(
      expect.arrayContaining(['background.ts', 'options/main.tsx', 'popup/main.tsx', 'sidepanel/main.tsx']),
    );
    for (const file of files) {
      const spec = firstImport(readFileSync(file, 'utf8'));
      expect(spec && path.resolve(path.dirname(file), spec), path.relative(ROOT, file)).toBe(
        path.join(ROOT, 'src/setup'),
      );
    }
  });

  it('puts Zod in jitless mode', async () => {
    await import('../../src/setup');
    expect(z.config().jitless).toBe(true);
  });
});
