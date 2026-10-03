/**
 * The size and assertion limits (tech_reviewer: files ≤ 400 lines, functions ≤ 60 lines, no `as unknown as`;
 * TECH-C8, QA-G13, TECH-R6, TECH-R8), proven through the real eslint.config.js of the extension and of the repo
 * root on virtual files:
 *  - every line counts, blank and comment lines included, and every function counts, the describe and it
 *    callbacks of a test file included (Decisions [1.v14-core]);
 *  - `x as unknown as T` fails in every scope, src/core, the bus, UI, entrypoints, tests, bench and scripts, and so
 *    does any assertion stacked on another, however spelled (`x as Opaque as T`, `x as unknown satisfies unknown as
 *    T`, `<T><unknown>x`, `(x as unknown)! as T`; PI-7);
 *  - the only files exempt from the size limits are the generated Unicode tables, exactly the files
 *    scripts/gen-unicode-baseline.ts writes;
 *  - no file in either tree switches a limit off with an inline comment (a test file could, unlike app code).
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { TABLE_FILES } from '../../../../scripts/gen-unicode-baseline';

const EXTENSION = path.resolve(import.meta.dirname, '../../..');
const REPO = path.resolve(EXTENSION, '..');
const LIMIT_RULES = ['max-lines', 'max-lines-per-function', 'no-restricted-syntax'];
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
/** Parsing every file of both trees: about 5 s alone, several times that under the load a full run puts on. */
const TREE_SCAN_TIMEOUT_MS = 300_000;

/** Type-aware rules off for virtual files; every file-scoped rule stays on (as in fences.spec.ts). */
const UNTYPED = {
  ...tseslint.configs.disableTypeChecked,
  languageOptions: { parserOptions: { projectService: false, project: null } },
};
const extension = new ESLint({ cwd: EXTENSION, overrideConfig: [UNTYPED] });
const root = new ESLint({ cwd: REPO, overrideConfig: [UNTYPED] });

/** The limit rules `code` breaks at `file`, as `rule` or `rule: message` for no-restricted-syntax. */
async function limits(file: string, code: string): Promise<string[]> {
  const [eslint, cwd] = file.startsWith('../') ? [root, REPO] : [extension, EXTENSION];
  const filePath = path.resolve(EXTENSION, file);
  const [result] = await eslint.lintText(code, { filePath });
  if (result === undefined) throw new Error(`no lint result for ${path.relative(cwd, filePath)}`);
  const fatal = result.messages.filter((m) => m.fatal === true).map((m) => m.message);
  expect(fatal, `${file}: the probe must parse`).toEqual([]);
  return result.messages
    .filter((m) => m.ruleId !== null && LIMIT_RULES.includes(m.ruleId))
    .map((m) => (m.ruleId === 'no-restricted-syntax' ? `${m.ruleId}: ${m.message}` : (m.ruleId ?? '')));
}

/** `count` lines of code, each a statement. */
const codeLines = (count: number): string =>
  Array.from({ length: count }, (_, i) => `export const v${String(i)} = 'v';\n`).join('');

/** A function exactly `lines` long, header and closing brace included. */
const functionOf = (lines: number): string =>
  `export function probe(): string {\n${'  // body\n'.repeat(lines - 3)}  return 'v';\n}\n`;

/** A test callback exactly `lines` long: `describe('probe', () => {` to `});`. */
const callbackOf = (call: string, lines: number): string =>
  `${call}('probe', () => {\n${'  // body\n'.repeat(lines - 2)}});\n`;

const DOUBLE_CAST = 'export const probe = (value: number): string => value as unknown as string;\n';

/** One file per scope whose block sets its own no-restricted-syntax list, and the scopes around them. */
const EXTENSION_SCOPES = [
  'src/core/probe.ts',
  'src/bus/probe.ts',
  'src/ledger/probe.ts',
  'src/ui/probe.tsx',
  'src/adapters/gmail/probe.ts',
  'entrypoints/background.ts',
  'entrypoints/content/probe.content.ts',
  'tests/unit/probe.spec.ts',
  'tests/e2e/probe.spec.ts',
  'tests/tools/probe.ts',
  'probe.config.ts',
];
const ROOT_SCOPES = ['../bench/probe.ts', '../scripts/probe.ts'];
const ALL_SCOPES = [...EXTENSION_SCOPES, ...ROOT_SCOPES];

describe('max-lines: 400 lines per file, every line counted', () => {
  it('400 lines pass and 401 fail, in every scope of both configs', async () => {
    for (const file of [...ALL_SCOPES, 'eslint-rules/probe.js', 'probe.config.js']) {
      expect(await limits(file, codeLines(400)), file).toEqual([]);
      expect(await limits(file, codeLines(401)), file).toEqual(['max-lines']);
    }
  });

  it('blank lines and comment lines count', async () => {
    for (const file of ['tests/unit/probe.spec.ts', 'src/core/probe.ts', '../scripts/probe.ts']) {
      expect(await limits(file, `${codeLines(1)}${'\n'.repeat(400)}`), file).toEqual(['max-lines']);
      expect(await limits(file, `${'// note\n'.repeat(400)}${codeLines(1)}`), file).toEqual(['max-lines']);
    }
  });
});

describe('max-lines-per-function: 60 lines per function, test callbacks included', () => {
  it('a 60-line function passes and a 61-line one fails, in every scope of both configs', async () => {
    for (const file of ALL_SCOPES) {
      expect(await limits(file, functionOf(60)), file).toEqual([]);
      expect(await limits(file, functionOf(61)), file).toEqual(['max-lines-per-function']);
    }
  });

  it('a describe or it callback over 60 lines fails, as does an immediately invoked function', async () => {
    for (const file of ['tests/unit/probe.spec.ts', 'tests/property/probe.property.spec.ts']) {
      for (const call of ['describe', 'it', 'test']) {
        expect(await limits(file, callbackOf(call, 60)), `${file} ${call}`).toEqual([]);
        expect(await limits(file, callbackOf(call, 61)), `${file} ${call}`).toEqual([
          'max-lines-per-function',
        ]);
      }
    }
    const iife = `(() => {\n${'  // body\n'.repeat(59)}})();\n`;
    expect(await limits('src/ui/probe.ts', iife)).toEqual(['max-lines-per-function']);
  });
});

describe('no `as unknown as`', () => {
  it('a double assertion through unknown fails in every scope of both configs', async () => {
    for (const file of ALL_SCOPES) {
      const found = await limits(file, DOUBLE_CAST);
      expect(found, file).toHaveLength(1);
      expect(found[0], file).toMatch(/^no-restricted-syntax: No `as unknown as`/);
    }
  });

  it('a single assertion, and an assertion from unknown to a type, pass', async () => {
    const single = 'export const probe = (value: number): unknown => value as unknown;\n';
    const parsed = "export const probe = JSON.parse('1') as number;\n";
    for (const file of ['src/core/probe.ts', 'tests/unit/probe.spec.ts', '../bench/probe.ts']) {
      expect(await limits(file, single), file).toEqual([]);
      expect(await limits(file, parsed), file).toEqual([]);
    }
  });

  it('any assertion stacked on another fails in every scope of both configs, however it is spelled (PI-7)', async () => {
    const stacked = [
      'type Opaque = unknown;\nexport const probe = (x: number): string => x as Opaque as string;\n',
      'export const probe = (x: number): string => x as unknown satisfies unknown as string;\n',
      'export const probe = (x: { a: number }): { b: string } => x as object as { b: string };\n',
      'export const probe = (x: number): string => (x as never) as string;\n',
      'export const probe = (x: number): string => (x as unknown)! as string;\n',
    ];
    for (const file of ALL_SCOPES) {
      for (const code of stacked) {
        const found = await limits(file, code);
        expect(found, `${file}: ${code}`).toHaveLength(1);
        expect(found[0], `${file}: ${code}`).toMatch(
          /^no-restricted-syntax: No `as unknown as`, and no assertion stacked/,
        );
      }
    }
    const angle = 'export const probe = (x: number): string => <string>(<unknown>x);\n';
    for (const file of ['src/core/probe.ts', 'tests/unit/probe.spec.ts', '../scripts/probe.ts'])
      expect(await limits(file, angle), file).toHaveLength(1);
  });

  it('control: an `as const` under an assertion, and `as const satisfies T`, pass', async () => {
    const code = [
      "export const a = ['x', 'y'] as const as readonly string[];",
      "export const b = { k: 'v' } as const satisfies Record<string, string>;",
      'export const c = (x: unknown): number => x as number;',
      '',
    ].join('\n');
    for (const file of ['src/core/probe.ts', 'tests/unit/probe.spec.ts', '../bench/probe.ts'])
      expect(await limits(file, code), file).toEqual([]);
  });

  it('the scopes that set their own no-restricted-syntax keep their other entries', async () => {
    const clock = 'export const now = (): number => Date.now();\n';
    expect((await limits('src/core/probe.ts', clock)).join('\n')).toMatch(/src\/core is pure: no clock/);
    const messaging = 'chrome.runtime.sendMessage({});\n';
    expect((await limits('src/ui/probe.ts', messaging)).join('\n')).toMatch(/goes through src\/bus/);
  });
});

describe('exemptions and inline switches', () => {
  const GENERATED = Object.values(TABLE_FILES).map((file) => path.relative('extension', file));

  it('the generated Unicode tables are exempt from the size limits, and nothing else is', async () => {
    expect(GENERATED.length).toBeGreaterThan(0);
    for (const file of GENERATED) expect(await limits(file, codeLines(401)), file).toEqual([]);
    expect(await limits('src/core/unicode-table-probe.ts', codeLines(401))).toEqual(['max-lines']);
    const files = await lintedFiles();
    expect(files).toContain(path.join('tests', 'unit', 'lint', 'size-rules.spec.ts'));
    expect(await sizeLimitsOff(files)).toEqual([...GENERATED].sort());
  });

  it(
    'no file in either tree switches a limit off with an inline comment',
    async () => {
      const found: string[] = [];
      for (const cwd of [EXTENSION, REPO]) {
        const directives = new ESLint({
          cwd,
          ruleFilter: () => false,
          overrideConfig: [UNTYPED, { linterOptions: { noInlineConfig: true } }],
        });
        for (const result of await directives.lintFiles(['.'])) {
          for (const { message, line } of result.messages) {
            const directive = /^'(.+)' has no effect/s.exec(message)?.[1] ?? message;
            if (switchesLimitOff(directive)) found.push(`${result.filePath}:${String(line)} ${directive}`);
          }
        }
      }
      expect(found).toEqual([]);
    },
    TREE_SCAN_TIMEOUT_MS,
  );

  it('the inline-comment check sees a blanket disable and a disable or config of a limit rule', () => {
    expect(switchesLimitOff('/* eslint-disable */')).toBe(true);
    expect(switchesLimitOff('// eslint-disable-next-line -- long on purpose')).toBe(true);
    expect(switchesLimitOff('// eslint-disable-next-line max-lines-per-function')).toBe(true);
    expect(switchesLimitOff('/* eslint max-lines: off */')).toBe(true);
    expect(switchesLimitOff('// eslint-disable-line no-restricted-syntax')).toBe(true);
    expect(switchesLimitOff('// eslint-disable-next-line @typescript-eslint/no-unsafe-call')).toBe(false);
  });
});

/** Every file the extension config lints, relative to extension/: a walk that skips what the config ignores. */
async function lintedFiles(dir = EXTENSION): Promise<string[]> {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      if (!(await extension.isPathIgnored(path.join(full, 'probe.ts'))))
        files.push(...(await lintedFiles(full)));
    } else if (SOURCE_FILE.test(entry.name) && !(await extension.isPathIgnored(full))) {
      files.push(path.relative(EXTENSION, full));
    }
  }
  return files;
}

/** The files, of `files`, whose resolved config does not set both size limits to error. */
async function sizeLimitsOff(files: readonly string[]): Promise<string[]> {
  const off = new Set<string>();
  for (const file of files) {
    const config = (await extension.calculateConfigForFile(path.join(EXTENSION, file))) as {
      rules?: Record<string, unknown>;
    };
    for (const rule of ['max-lines', 'max-lines-per-function']) {
      const setting = config.rules?.[rule];
      const severity: unknown = Array.isArray(setting) ? setting[0] : setting;
      if (severity !== 2 && severity !== 'error') off.add(file);
    }
  }
  return [...off].sort();
}

/** Whether an inline ESLint comment switches off a limit: a disable naming no rule, or one naming a limit rule. */
function switchesLimitOff(directive: string): boolean {
  const text = directive.replace(/\s--\s.*$/s, '').trim();
  const blanket = /^(?:\/\/|\/\*)\s*eslint-(?:disable|enable)(?:-next-line|-line)?\s*(?:\*\/)?$/.test(text);
  return blanket || LIMIT_RULES.some((rule) => new RegExp(`\\b${rule}\\b`).test(text));
}
