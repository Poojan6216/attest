/**
 * A test-only entry under tests/ bundled into one classic script (IIFE), in memory, for a test to inject into a page
 * (tests/e2e/observer-skeleton.spec.ts, sprint_2 2.0; tests/e2e/perf-gmail.spec.ts, sprint_6 6.4). Nothing is written
 * to disk, and nothing under tests/ is ever part of the build WXT ships (tests/e2e/built-bundle.spec.ts).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** `entry` bundled as one script defining the global `name`. */
export async function bundleTestScript(entry: string, name: string): Promise<string> {
  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      lib: { entry, formats: ['iife'], name, fileName: () => 'bundle.js' },
    },
  });
  for (const output of Array.isArray(result) ? result : [result]) {
    if (!('output' in output)) continue;
    for (const chunk of output.output) if (chunk.type === 'chunk') return chunk.code;
  }
  throw new Error(`vite produced no bundle of ${path.relative(ROOT, entry)}`);
}
