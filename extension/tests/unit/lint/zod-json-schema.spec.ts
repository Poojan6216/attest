/**
 * wxt.config.ts `zodWithoutJsonSchema` (TECH-17): zod classic's JSON Schema code, which Attest never calls, is left
 * out of every bundle, and nothing Attest does with zod changes. A small bundle is built with Vite exactly as the
 * extension's are, with and without the plugin, and run: parsing, the `.minLength` getter (which reads the real
 * `aggregateChecks`) and errors work; `toJSONSchema()` throws instead of running code that was not shipped; and the
 * JSON Schema draft URLs, which only that code holds, are gone. The names the stand-ins export are read from zod's
 * own file, so this also fails if a zod upgrade moves them.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build, type Plugin } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { zodJsonSchemaNames, zodWithoutJsonSchema } from '../../../wxt.config';

// wxt.config.ts imports `defineConfig` from 'wxt', which loads WXT and, in the background, its optional `web-ext` peer
// (not installed: an unhandled rejection under CI's coverage run). `defineConfig` returns its argument, so a stub that
// does the same keeps this file's reads exact and never loads WXT.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

const ROOT = path.resolve(import.meta.dirname, '../../..');
const work = mkdtempSync(path.join(os.tmpdir(), 'attest-zod-'));

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

const ENTRY = `
import { z } from 'zod';
const name = z.string().min(3);
export const parsed = name.safeParse('abcd').success;
export const refused = name.safeParse('ab').error?.issues[0]?.code;
export const minLength = name.minLength;
export const toJson = () => name.toJSONSchema();
`;

/** Builds ENTRY as an ES module with `plugins`, the way wxt.config.ts builds the extension, and returns its code. */
async function bundle(plugins: Plugin[]): Promise<string> {
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, ENTRY);
  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    plugins,
    // The entry lives outside the extension: `zod` is the extension's own copy, as in its build.
    resolve: { alias: [{ find: /^zod$/, replacement: path.join(ROOT, 'node_modules/zod/index.js') }] },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: () => 'out.js' },
    },
  });
  for (const output of Array.isArray(result) ? result : [result]) {
    if (!('output' in output)) continue;
    for (const chunk of output.output) if (chunk.type === 'chunk') return chunk.code;
  }
  throw new Error('vite produced no bundle');
}

async function run(code: string): Promise<Record<string, unknown>> {
  const file = path.join(work, `run-${String(Math.random()).slice(2)}.mjs`);
  writeFileSync(file, code);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

describe('zod without its JSON Schema code (TECH-17)', () => {
  it('reads the names zod classic uses from zod itself', () => {
    const classic = path.join(ROOT, 'node_modules/zod/v4/classic/schemas.js');
    const names = zodJsonSchemaNames(readFileSync(classic, 'utf8'));
    expect(names.toJsonSchema).toEqual(['createStandardJSONSchemaMethod', 'createToJSONSchemaMethod']);
    expect(names.processors).toContain('aggregateChecks');
    expect(names.processors).toContain('stringProcessor');
    expect(names.processors).not.toContain('js');
  });

  it('the plugin drops the JSON Schema code; parsing, errors and the getters still work', async () => {
    const without = await bundle([zodWithoutJsonSchema()]);
    const withIt = await bundle([]);
    // The control: an ordinary build ships the draft URLs only the JSON Schema code holds.
    expect(withIt).toContain('json-schema.org');
    expect(without).not.toContain('json-schema.org');
    expect(without.length).toBeLessThan(withIt.length - 20_000);
    const shipped = await run(without);
    expect(shipped.parsed).toBe(true);
    expect(shipped.refused).toBe('too_small');
    expect(shipped.minLength).toBe(3);
    expect(() => (shipped.toJson as () => unknown)()).toThrow('zod JSON Schema is not shipped in Attest');
  });
});
