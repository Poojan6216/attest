/**
 * Lint holds every global src/core reads to the allowlist, and keeps the ES2023-only type check on (R4-FENCE-1,
 * R4-FENCE-2; Hard Rules 1 and 4), proven through the project's real eslint.config.js on virtual files in src/core.
 * A read of a global off CORE_ALLOWED_GLOBALS (eslint-rules/core-names.js) is reported by attest/core-globals, or by
 * no-restricted-globals or attest/no-network when they name it; `clientInformation` and the window's loaders and ways
 * out (`Image`, `Audio`, `FontFace`, `Worker`, `open`, `postMessage`, …) are now named, so the runtime guard poisons
 * them too. `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck` and triple-slash references are refused in src/core, where
 * each would switch off the typecheck that keeps host names out. The verifier's two probes are checked as written.
 */
import path from 'node:path';

import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { CORE_ALLOWED_GLOBALS, CORE_RESTRICTED_GLOBAL_NAMES } from '../../../eslint-rules/core-names.js';
import coreGlobals from '../../../eslint-rules/core-globals.js';

const root = path.resolve(import.meta.dirname, '../../..');

const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      ...tseslint.configs.disableTypeChecked,
      languageOptions: { parserOptions: { projectService: false, project: null } },
    },
  ],
});

async function ruleIds(code: string, filePath = 'src/core/probe.ts'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  if (!result) throw new Error('no lint result');
  return result.messages.map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const ALLOWLIST = 'attest/core-globals';
const RESTRICTED = 'no-restricted-globals';
const TS_COMMENT = '@typescript-eslint/ban-ts-comment';
const TRIPLE_SLASH = '@typescript-eslint/triple-slash-reference';

/** The window's names the brief and the verifier named, now on the shared restricted list (R4-FENCE-1/2). */
const NAMED = [
  'clientInformation', 'Image', 'Audio', 'FontFace', 'Worker', 'SharedWorker', 'Notification', 'BroadcastChannel',
  'open', 'opener', 'parent', 'top', 'frames', 'postMessage', 'navigation',
] as const; // prettier-ignore

/** Host names and unsafe built-ins no list names: the allowlist alone refuses them. */
const UNNAMED = [
  'Option', 'MessageChannel', 'name', 'length', 'origin', 'external', 'CSS', 'structuredClone', 'queueMicrotask',
  'TextEncoder', 'URL', 'Blob', 'Request', 'Function', 'eval', 'Proxy', 'escape', 'unescape',
] as const; // prettier-ignore

describe('src/core globals: an allowlist, not a denylist (R4-FENCE-1, R4-FENCE-2)', () => {
  it.each(NAMED)('%s is on the shared restricted list, and lint reports it there', async (name) => {
    expect(CORE_RESTRICTED_GLOBAL_NAMES).toContain(name);
    expect(await ruleIds(`export const v = (): unknown => ${name};\n`)).toEqual([RESTRICTED]);
  });

  it.each(UNNAMED)('%s, on no list, is reported by attest/core-globals', async (name) => {
    expect(CORE_RESTRICTED_GLOBAL_NAMES).not.toContain(name);
    for (const code of [
      `export const v = (): unknown => ${name};\n`,
      `export const v = (): boolean => typeof ${name} === 'undefined';\n`,
    ])
      expect(await ruleIds(code), code).toContain(ALLOWLIST);
  });

  it('every allowed built-in passes both, and a local, a parameter or a member named like a host global passes', async () => {
    const reads = [...CORE_ALLOWED_GLOBALS].map((name) => `export const v${name} = (): unknown => ${name};`);
    const found = await ruleIds(`${reads.join('\n')}\n`);
    expect(found.filter((rule) => rule === ALLOWLIST || rule === RESTRICTED)).toEqual([]);
    const code = [
      'export const f = (top: number, Image: number): number => top + Image;',
      'export const g = (o: { name: string; open: () => void }): string => o.name;',
      'export class Option {\n  readonly v = 1;\n}',
      'export const h = (): Option => new Option();',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });

  it('src/core resolves attest/core-globals and the type-check bans, as ESLint computes them', async () => {
    const config: unknown = await eslint.calculateConfigForFile(path.join(root, 'src/core/probe.ts'));
    const rules = (config as { rules?: Record<string, unknown> }).rules ?? {};
    expect(rules[ALLOWLIST]).toEqual([2]);
    expect(rules[TS_COMMENT]).toEqual([
      2,
      expect.objectContaining({ 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true }),
    ]);
    expect(rules[TRIPLE_SLASH]).toEqual([2, { lib: 'never', path: 'never', types: 'never' }]);
  });
});

/** The verifier's probes n19 and n16, as written into grade.ts (close round 4). */
const N19 =
  "  try {\n    // @ts-expect-error -- the host image loader, absent from the core lib\n    const Pixel = Image as new () => { src: string };\n    new Pixel().src = 'https://t.example/g.gif?graded=1';\n  } catch {\n    // no images on this host\n  }";
const N16 =
  "  // @ts-expect-error -- the host navigator alias, absent from the core lib\n  const ci2 = typeof clientInformation === 'undefined' ? undefined : (clientInformation as { language?: string });\n  if (ci2?.language === 'de') void 0;";

const inGrade = (body: string): string =>
  `export function grade(policy: object): void {\n  void policy;\n${body}\n}\n`;

describe("src/core: the verifier's probes and the type-check directives (R4-FENCE-1, R4-FENCE-2)", () => {
  it.each([
    ['n19, an Image beacon', N19],
    ['n16, clientInformation', N16],
  ])('%s fails lint on the global and on the @ts-expect-error', async (_, body) => {
    const found = await ruleIds(inGrade(body));
    expect(found).toContain(RESTRICTED);
    expect(found).toContain(TS_COMMENT);
  });

  it('the same probe with a name on no list fails on the allowlist', async () => {
    const found = await ruleIds(inGrade(N19.replace('Image as', 'Option as')));
    expect(found).toContain(ALLOWLIST);
    expect(found).toContain(TS_COMMENT);
  });

  it.each([
    ['// @ts-expect-error -- the host image loader, absent from the core lib', TS_COMMENT],
    ['// @ts-ignore -- the host image loader, absent from the core lib', TS_COMMENT],
    ['/* @ts-ignore */', TS_COMMENT],
    ['// @ts-nocheck', TS_COMMENT],
    ['/// <reference lib="dom" />', TRIPLE_SLASH],
    ['/// <reference types="node" />', TRIPLE_SLASH],
  ])('%s fails in src/core', async (comment, rule) => {
    expect(await ruleIds(`${comment}\nexport const v = 1;\n`)).toContain(rule);
  });

  it('control: elsewhere a described @ts-expect-error and a lib reference stay allowed', async () => {
    const code =
      '// @ts-expect-error -- a deliberate type error in a test fixture\nexport const v: string = 1;\n';
    expect(await ruleIds(code, 'src/ui/probe.ts')).not.toContain(TS_COMMENT);
    const lib = '/// <reference lib="dom" />\nexport const v = 1;\n';
    expect(await ruleIds(lib, 'src/ui/probe.ts')).not.toContain(TRIPLE_SLASH);
  });
});

describe('src/core reads RegExp only as new RegExp(…) or instanceof (Hard Rule 4)', () => {
  it.each([
    'export const m = (): string => RegExp.lastMatch;\n',
    'export const m = (): string => RegExp.$1;\n',
    "export const m = (): unknown => RegExp['$&'];\n",
    'const R = RegExp;\nexport const m = (): unknown => R;\n',
    'const { leftContext } = RegExp;\nexport const m = leftContext;\n',
    "export const m = (): unknown => Reflect.get(RegExp, 'input');\n",
  ])('%s fails attest/core-determinism', async (code) => {
    expect(await ruleIds(code)).toContain('attest/core-determinism');
  });

  it('control: new RegExp(…), instanceof RegExp and a RegExp type pass', async () => {
    const code = [
      "export const a = new RegExp('^a+$', 'u');",
      'export const b = (v: unknown): boolean => v instanceof RegExp;',
      "export const c = (r: RegExp): boolean => r.test('a');",
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });
});

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tsTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module', parser: tseslint.parser },
});
const notAllowed = (code: string, count = 1) => ({
  code,
  errors: Array.from({ length: count }, () => ({ messageId: 'notAllowed' })),
});

tsTester.run('attest/core-globals', coreGlobals, {
  valid: [
    'export const a = new Map<string, number>([[String(1), Number.NaN]]);',
    'export const b = (Image: number) => Image;',
    "import { open } from './open';\nexport const c = open;",
    'export const d = (o: { URL: string }) => o.URL;',
    'export type T = URL;',
    // Named by no-restricted-globals or attest/no-network, which report them in src/core with their own messages.
    'export const e = [navigator, Image, fetch, EventSource];',
  ],
  invalid: [
    notAllowed('export const a = new Option();'),
    notAllowed("export const b = typeof structuredClone === 'function';"),
    notAllowed("export const c = (0, eval)('1');"),
    notAllowed("export const d = Function('return this')();"),
    notAllowed('const U = URL;\nexport const e = new U(String(1));'),
    notAllowed('declare const Option: new () => object;\nexport const f = new Option();'),
    notAllowed('export const g = [name, length];', 2),
  ],
});
