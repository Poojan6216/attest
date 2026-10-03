/**
 * attest/core-determinism with type information (Hard Rule 4; TECH-C2). A Date made into text renders in the host's
 * time zone: `date.toString()`, `String(date)` and `dates.join()` must fail in src/core, while the same calls on
 * numbers, strings and arrays of strings pass. These need types, so each case is a real file in a temporary
 * TypeScript project, linted with the projectService as `pnpm lint` lints src/core. The last block proves the real
 * eslint.config.js gives src/core that type information, so the check is live there and not only here.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';

import attest from '../../../eslint-rules/index.js';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-core-determinism-'));
writeFileSync(
  path.join(dir, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2023', lib: ['ES2023'], module: 'ESNext', types: [] },
    include: ['*.ts'],
  }),
);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const typed = new ESLint({
  cwd: dir,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { projectService: true, tsconfigRootDir: dir },
      },
      plugins: { attest },
      rules: { 'attest/core-determinism': 'error' },
    },
  ],
});

let cases = 0;

/** The core-determinism messages for `code`, linted as its own file in the typed project. */
async function messages(code: string): Promise<string[]> {
  const file = path.join(dir, `case-${String((cases += 1))}.ts`);
  writeFileSync(file, `${code}\n`);
  const [result] = await typed.lintFiles([file]);
  if (!result) throw new Error('no lint result');
  return result.messages.map((m) => (m.ruleId === null ? `fatal: ${m.message}` : m.message));
}

describe('attest/core-determinism, typed: a Date made into text fails', () => {
  it.each([
    ['export const s = (d: Date): string => d.toString();', 'toString of a Date'],
    ['export const s = (d: Date | undefined) => d?.toString();', 'toString of a Date'],
    ['export const s = (iso: string): string => new Date(iso).toString();', 'toString of a Date'],
    ['export const f = (d: Date) => d.toString;', 'toString of a Date'],
    ['export const s = (d: Date): string => String(d);', 'String(date)'],
    ['export const s = (d: [Date, number]): string => String(d);', 'String(date)'],
    ["export const s = (d: Date): string => [d].join(',');", 'join over Date values'],
    ['export const s = (ds: readonly Date[]): string => ds.join();', 'join over Date values'],
    ['export const s = (ds: Date[]): string => ds.toString();', 'toString of a Date'],
  ])('%s', async (code, name) => {
    expect(await messages(code)).toEqual([
      `src/core is deterministic: '${name}' depends on the host time zone. Use the UTC methods (Hard Rule 4).`,
    ]);
  });
});

describe('attest/core-determinism, typed: controls', () => {
  it('UTC renderings of a Date, and toString, String and join on anything else pass', async () => {
    const code = [
      'export const a = (d: Date): string => d.toISOString();',
      'export const b = (d: Date): string => d.toUTCString();',
      'export const c = (d: Date): string => String(d.getTime());',
      'export const e = (n: number): string => n.toString(16);',
      'export const f = (n: number): string => String(n);',
      "export const g = (xs: string[]): string => xs.join(',');",
      'export const h = (x: { toString(): string }): string => x.toString();',
      'export const i = (iso: string): number => new Date(iso).getTime();',
    ].join('\n');
    expect(await messages(code)).toEqual([]);
  });
});

describe('the real eslint.config.js lints src/core with type information', () => {
  it('src/core files get the projectService (never disableTypeChecked) and attest/core-determinism', async () => {
    const config = (await new ESLint({ cwd: EXTENSION }).calculateConfigForFile(
      path.join(EXTENSION, 'src/core/grade.ts'),
    )) as { languageOptions?: { parserOptions?: Record<string, unknown> }; rules?: Record<string, unknown> };
    expect(config.languageOptions?.parserOptions?.projectService).toBeTruthy();
    expect(config.languageOptions?.parserOptions?.program ?? undefined).toBeUndefined();
    expect(config.rules?.['attest/core-determinism']).toEqual([2]);
  });
});
