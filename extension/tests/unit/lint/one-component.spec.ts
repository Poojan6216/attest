/**
 * One component per file (build_spec.md §5, locked; agents/ux_engineer.md rule 12; Sprint 5 close, tech review
 * TECH-8): every .tsx file of the pages and the shared UI declares at most one component, a top-level function whose
 * name begins with a capital. The development page (entrypoints/dev, never in the store build) is the one exception.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const ROOTS = ['entrypoints', 'src/ui'];
const EXCEPTIONS = new Set(['entrypoints/dev/App.tsx']);
const COMPONENT = /^(?:export\s+)?function\s+([A-Z][A-Za-z0-9]*)\s*\(/gmu;

/** Every .tsx file under `dir`, relative to extension/. */
function tsxFiles(dir: string): string[] {
  return readdirSync(path.join(EXTENSION, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(relative);
    return entry.name.endsWith('.tsx') ? [relative] : [];
  });
}

describe('one component per file', () => {
  it('holds for every page and shared UI file but the development page', () => {
    const files = ROOTS.flatMap(tsxFiles);
    expect(files.length).toBeGreaterThan(40);
    const crowded = files
      .filter((file) => !EXCEPTIONS.has(file))
      .map((file) => ({
        file,
        names: [...readFileSync(path.join(EXTENSION, file), 'utf8').matchAll(COMPONENT)].map((m) => m[1]),
      }))
      .filter(({ names }) => names.length > 1);
    expect(crowded).toEqual([]);
  });
});
