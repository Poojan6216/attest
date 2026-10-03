/**
 * attest/core-determinism with type information (Hard Rule 4; TECH-C2, PI-1, PI-3, PI-4). A Date made into text
 * renders in the host's time zone: `date.toString()`, `String(date)` and `dates.join()` must fail in src/core, while
 * the same calls on numbers, strings and arrays of strings pass. A Date is built only from one number or Date (a
 * string parses in the host's time zone or by the engine's rules), is never read with a key that is not written
 * (`date[Symbol.toPrimitive]`, `date[KEY]`), and no value but the global `Date` may be typed DateConstructor (the
 * constructor reached from an instance has the clock). These need types, so each case is a real file in a temporary
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
    ['export const s = (ms: number): string => new Date(ms).toString();', 'toString of a Date'],
    ['export const s = (d: Date): string => new String(d).valueOf();', 'String(date)'],
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
      'export const i = (ms: number): number => new Date(ms).getTime();',
      'export const j = (d: Date): number => new Date(d).getTime();',
      'export const k = (ms: 0 | 1 | number): Date => new Date(ms);',
      "export const l = (d: Date): number => d['getTime']();",
      'export const m = (ds: readonly Date[], i: number): Date | undefined => ds[i];',
      'export const n = (x: unknown): boolean => x instanceof Date;',
      'export const o = (y: number): number => Date.UTC(y, 0, 1);',
    ].join('\n');
    expect(await messages(code)).toEqual([]);
  });
});

const DATE_ARGUMENT =
  "src/core is deterministic: `new Date(text)` reads the host's time zone or the engine's own parser. Build a Date from epoch ms (normalize-time's instantMs reads text) (Hard Rule 4).";
const DATE_KEY =
  'src/core is deterministic: no computed member of a Date whose key is not written (`date[key]`, `date[Symbol.toPrimitive]`) (Hard Rule 4).';
const DATE =
  'src/core is pure: use Date only as `new Date(value)` with one number or Date, or `Date.UTC(…)`; pass time in as an argument (Hard Rule 4).';

describe('attest/core-determinism, typed: a Date is built from one number or Date (PI-1)', () => {
  it.each([
    'export const p = (iso: string): number => new Date(iso).getTime();',
    "export const p = (): number => new Date('2026-01-01T00:00:00').getTime();",
    'export const p = (v: string | number): number => new Date(v).getTime();',
    'export const p = (v: unknown): number => new Date(v as never).getTime();',
    'export const p = (v: bigint): Date => new Date(v as never);',
  ])('%s', async (code) => {
    expect(await messages(code)).toEqual([DATE_ARGUMENT]);
  });
});

describe('attest/core-determinism, typed: no key that is not written, no other DateConstructor (PI-3, PI-4)', () => {
  it.each([
    ["export const p = (iso: number): string => new Date(iso)[Symbol.toPrimitive]('string');", [DATE_KEY]],
    ["const P = Symbol.toPrimitive; export const p = (d: Date): string => d[P]('default');", [DATE_KEY]],
    ["const KEY = 'constructor'; export const p = (d: Date): unknown => d[KEY];", [DATE_KEY]],
    ['export const p = (d: Date, k: keyof Date): unknown => d[k];', [DATE_KEY]],
    ['export const p = (): number => (new Date(0).constructor as DateConstructor).now();', [DATE]],
    ['export const p = (D: DateConstructor): number => D.now();', [DATE]],
    ['export const p = (D: DateConstructor): Date => new D(0);', [DATE]],
    ['export const p = (x: object): DateConstructor => x as DateConstructor;', [DATE]],
  ])('%s', async (code, expected) => {
    expect(await messages(code)).toEqual(expected);
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

const LOCAL_TEXT = (name: string) =>
  `src/core is deterministic: '${name}' of a value whose type may hide a Date (\`unknown\`, \`any\`, \`object\`, a type parameter) renders the host's time zone when one is passed. Narrow it first (Hard Rule 4).`;
const DATE_REFLECTION =
  'src/core is deterministic: no reflection on a Date (its prototype holds the local-time methods and the constructor with the clock) (Hard Rule 4).';

describe('attest/core-determinism, typed: text of a value whose type may hide a Date (FR3-2)', () => {
  it.each([
    ['const text = (value: unknown): string => String(value);', 'String(value)'],
    ['export const s = (value: object): string => new String(value).valueOf();', 'String(value)'],
    ['export const s = <T,>(value: T): string => String(value);', 'String(value)'],
    ['export const s = (value: {}): string => String(value);', 'String(value)'],
    ["const joined = (values: readonly unknown[]): string => values.join('|');", 'join'],
    ['export const s = <T extends object>(values: T[]): string => values.toString();', 'toString'],
    ['export const s = (value: object): string => value.toString();', 'toString'],
    ['export const s = (value: unknown): string => `v=${value as object}`;', 'a template'],
    ["export const s = (value: object): string => 'v=' + value;", '+'],
  ])('%s', async (code, name) => {
    expect(await messages(code)).toEqual([LOCAL_TEXT(name)]);
  });

  it('a Date in a template or after `+` is reported as local time', async () => {
    expect(await messages('export const s = (d: Date): string => `${d}`;')).toEqual([
      "src/core is deterministic: 'a template of a Date' depends on the host time zone. Use the UTC methods (Hard Rule 4).",
    ]);
    expect(await messages("export const s = (d: Date): string => '' + d;")).toEqual([
      "src/core is deterministic: '+ on a Date' depends on the host time zone. Use the UTC methods (Hard Rule 4).",
    ]);
  });

  it('control: text of strings, numbers, narrowed values and string-constrained type parameters passes', async () => {
    const code = [
      'export const a = (n: number, s: string): string => String(n) + String(s) + `${n}${s}`;',
      "export const b = (xs: readonly (string | number)[]): string => xs.join(',') + xs.toString();",
      "export const c = <T extends string>(x: T): string => `${x}` + String(x) + [x].join('');",
      "export const d = (x: unknown): string => (typeof x === 'string' ? String(x) : 'other');",
      'export const e = (x: string & {}): string => `${x}` + x;',
      'export const f = (t: TemplateStringsArray, ...v: unknown[]): number => t.length + v.length;',
      'export const g = f`a${1 as unknown}b`;',
      'export const h = (n: number, m: number): number => n + m;',
    ].join('\n');
    expect(await messages(code)).toEqual([]);
  });
});

describe('attest/core-determinism, typed: no reflection on a Date (FR3-2)', () => {
  it.each([
    'export const p = Object.getPrototypeOf(new Date(0));',
    "export const p = (d: Date): unknown => Object.getOwnPropertyDescriptor(d, 'getTime');",
    "export const p = (d: Date): unknown => Reflect.get(d, 'getTime');",
    "export const p = (d: Date | undefined): boolean => d !== undefined && Reflect.has(d, 'getTime');",
  ])('%s', async (code) => {
    expect(await messages(code)).toEqual([DATE_REFLECTION]);
  });

  it('the verifier probes q01 to q04 each fail', async () => {
    const probes = [
      "const DATE_PROTOTYPE: unknown = Object.getPrototypeOf(new Date(0));\nexport const OFFSET: unknown = typeof DATE_PROTOTYPE === 'object' && DATE_PROTOTYPE !== null ? Reflect.get(DATE_PROTOTYPE, 'getTimezone' + 'Offset') : undefined;",
      "const DATE_PROTOTYPE: unknown = Object.getPrototypeOf(new Date(0));\nexport const KEY = typeof DATE_PROTOTYPE === 'object' && DATE_PROTOTYPE !== null ? Object.getOwnPropertyNames(DATE_PROTOTYPE).find((name) => name.startsWith('con')) : '';",
      "export const FORMAT: unknown = Reflect.get(Number, 'toLocale' + 'String');",
      'const text = (value: unknown): string => String(value);\nexport const q04 = (ms: number): string => text(new Date(ms));',
      "const joined = (values: readonly unknown[]): string => values.join('|');\nexport const q04join = (ms: number): string => joined([new Date(ms)]);",
    ];
    for (const code of probes) expect((await messages(code)).length, code).toBeGreaterThan(0);
  });
});
