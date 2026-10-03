/**
 * The src/core fences (build_spec §6, Hard Rule 4), proven through the project's real eslint.config.js on virtual
 * files in src/core. Imports are an allowlist (TECH-C2): src/core may import its own modules (`./name`), `zod`
 * and `../../../policy/default.json`, and nothing else, so the modules next door that read the clock or the
 * extension's settings (`../clock`, `../config`, `../setup`) fail too. Globals whose answer depends on the
 * clock, randomness, the host or the garbage collector (WeakRef, FinalizationRegistry) fail. Each probe must
 * fail lint; each control (what src/core legitimately does today) must not. The last blocks hold the bypasses found
 * after the Sprint 1 close (PI-1 to PI-4): a spread or multi-field `new Date`, an ambient declaration that hides a
 * global, the Date constructor reached through `.constructor`, and `Symbol.toPrimitive`; then the forms the third
 * verification found: the constructor reached by destructuring (UNI-R3-3), error stacks, the stack API and
 * `import.meta` (FR3-3), and reflection or mutation of built-ins (FR3-2). Each control is what src/core does today.
 * tests/unit/core/core-purity.spec.ts checks the real files for the same things without lint, and
 * tests/unit/core/core-poison.spec.ts (and `pnpm test:poison`) runs the core with every impure global poisoned.
 */
import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

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

const PROBE = 'src/core/probe.ts';

async function messages(code: string, filePath = PROBE): Promise<ESLint.LintResult['messages']> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  if (!result) throw new Error('no lint result');
  return result.messages;
}

async function ruleIds(code: string, filePath = PROBE): Promise<string[]> {
  return (await messages(code, filePath)).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const importOf = (specifier: string) => `import * as x from '${specifier}';\nexport const y = x;\n`;

describe('src/core imports: an allowlist, not a denylist (TECH-C2)', () => {
  it.each([
    ['../clock', 'reads the wall clock (nowIso)'],
    ['../config', "the extension's constants"],
    ['../setup', 'extension setup'],
    ['../log-vocabulary', 'logging'],
    ['../../../policy/other.json', 'a second data file'],
    ['../../policy/default.json', 'the policy by a path that is not the shipped one'],
    ['./sub/module', 'a subfolder'],
    ['./Schema', 'a sibling spelled with other letter case'],
    ['./schema.ts', 'a sibling with an extension'],
    ['zod/v4', 'a zod subpath'],
    ['ulid', 'any other package'],
  ])('importing %s (%s) fails with the allowlist message', async (specifier) => {
    const found = await messages(importOf(specifier));
    expect(found.map((m) => m.ruleId)).toContain('no-restricted-imports');
    expect(found.map((m) => m.message).join('\n')).toContain('src/core imports only its own modules');
  });

  it('re-exports, type-only imports and import-require are checked too', async () => {
    for (const code of [
      "export * from '../clock';\n",
      "export { nowIso } from '../clock';\n",
      "import type { Clock } from '../clock';\nexport type C = Clock;\n",
      "import c = require('../clock');\nexport const t = c;\n",
    ]) {
      expect(await ruleIds(code), code).toContain('no-restricted-imports');
    }
  });

  it('a dynamic import fails', async () => {
    expect(await ruleIds("export const m = import('./schema');\n")).toContain('no-restricted-syntax');
  });

  it('control: what src/core imports today passes (sibling modules, zod, the shipped policy)', async () => {
    const code = [
      "import { z } from 'zod';",
      "import type { Claim } from './schema';",
      "import { MS_PER_MINUTE } from './units';",
      "import defaultPolicyJson from '../../../policy/default.json';",
      "export { canonicalJson } from './hash';",
      "export * from './candidates-time';",
      'export const all = [z, MS_PER_MINUTE, defaultPolicyJson];',
      'export type C = Claim;',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });

  it('the allowlist binds src/core only: src/ui may still import ../clock', async () => {
    expect(await ruleIds(importOf('../clock'), 'src/ui/probe.ts')).toEqual([]);
  });
});

describe('src/core imports: the named bans keep their own messages', () => {
  it('import Dexie in src/core fails', async () => {
    expect(await ruleIds("import Dexie from 'dexie';\nexport const d = Dexie;\n")).toContain(
      'no-restricted-imports',
    );
  });

  it('src/core cannot import impure layers', async () => {
    for (const spec of [
      '../ledger/db',
      '../bus/send',
      '../adapters/base',
      '../observers/base',
      '../log',
      'wxt/browser',
      'node:fs',
    ]) {
      expect(await ruleIds(importOf(spec)), spec).toContain('no-restricted-imports');
    }
    const ledger = await messages(importOf('../ledger/db'));
    expect(ledger.map((m) => m.message).join('\n')).toContain('must not import from impure layers');
  });
});

describe('src/core globals and syntax (Hard Rule 4)', () => {
  it('src/core cannot read the clock, randomness, or extension/DOM globals', async () => {
    const cases: [string, string][] = [
      ['export const t = Date.now();\n', 'no-restricted-syntax'],
      ['export const t = new Date();\n', 'no-restricted-syntax'],
      ['export const r = Math.random();\n', 'no-restricted-syntax'],
      ['export const b = new Uint8Array(4); crypto.getRandomValues(b);\n', 'no-restricted-globals'],
      ['export const id = chrome.runtime.id;\n', 'no-restricted-globals'],
      ['export const t = document.title;\n', 'no-restricted-globals'],
      ["export const p = fetch('x');\n", 'no-restricted-globals'],
      // The host's language and location, a beacon, and a host-timed callback (FS-1).
      ['export const l = navigator.language;\n', 'no-restricted-globals'],
      ["navigator.sendBeacon('https://x.example', '');\n", 'attest/no-network'],
      ['export const h = location.href;\n', 'no-restricted-globals'],
      ['requestIdleCallback(() => undefined);\n', 'no-restricted-globals'],
    ];
    for (const [code, rule] of cases) expect(await ruleIds(code), code).toContain(rule);
  });

  it('WeakRef and FinalizationRegistry fail: their results depend on the garbage collector (TECH-C2)', async () => {
    const cases: [string, string][] = [
      ['export const t = new WeakRef({}).deref();\n', 'no-restricted-globals'],
      ['export const r = new FinalizationRegistry(() => undefined);\n', 'no-restricted-globals'],
      ['export const W = globalThis.WeakRef;\n', 'no-restricted-properties'],
      ['export const F = self.FinalizationRegistry;\n', 'no-restricted-properties'],
      [
        'export const w = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);\n',
        'no-restricted-globals',
      ],
    ];
    for (const [code, rule] of cases) expect(await ruleIds(code), code).toContain(rule);
  });

  it('control: src/core may build dates from inputs and use WeakMap memos', async () => {
    const code =
      'export const t = (ms: number) => new Date(ms).getTime();\nexport const memo = new WeakMap<object, number>();\n';
    expect(await ruleIds(code)).toEqual([]);
  });
});

/** Each probe must fail with every rule listed (the verifier's probes, PI-1 to PI-4). */
async function expectCaught(cases: readonly (readonly [string, readonly string[]])[]): Promise<void> {
  for (const [code, rules] of cases) {
    const found = await ruleIds(code);
    for (const rule of rules) expect(found, code).toContain(rule);
  }
}

const SYNTAX = 'no-restricted-syntax';
const DETERMINISM = 'attest/core-determinism';

describe('new Date takes exactly one value, never a spread, fields or written text (PI-1)', () => {
  it('a spread, several fields and a written string fail', async () => {
    await expectCaught([
      [
        'const none: [] = [];\nexport const p = (): number => new Date(...none).getTime();\n',
        [SYNTAX, DETERMINISM],
      ],
      ['export const p = (): string => new Date(...([] as const)).toISOString();\n', [SYNTAX, DETERMINISM]],
      [
        'export const p = (y: number, m: number, d: number): number => new Date(y, m, d).getTime();\n',
        [SYNTAX, DETERMINISM],
      ],
      ['export const p = (y: number, m: number): Date => new Date(y, m);\n', [SYNTAX, DETERMINISM]],
      ["export const p = (): number => new Date('2026-01-01T00:00:00').getTime();\n", [DETERMINISM]],
      ['export const p = (): number => new Date(`2026-01-01`).getTime();\n', [DETERMINISM]],
    ]);
  });
});

describe('src/core declares no globals (PI-2)', () => {
  it('an ambient declaration fails, and the global it hides is still seen', async () => {
    await expectCaught([
      [
        'declare const Date: DateConstructor;\nconst D = Date;\nexport const p = (): number => D.now();\n',
        [SYNTAX, DETERMINISM],
      ],
      [
        'declare const Math: { random: () => number };\nconst M = Math;\nexport const p = (): number => M.random();\n',
        [SYNTAX, DETERMINISM],
      ],
      [
        'declare const Temporal: { Now: { instant: () => { epochMilliseconds: number } } };\nexport const p = (): number => Temporal.Now.instant().epochMilliseconds;\n',
        [SYNTAX],
      ],
      [
        'declare const performance: { now: () => number };\nexport const p = (): number => performance.now();\n',
        [SYNTAX],
      ],
      ['declare let x: number;\nexport const p = x;\n', [SYNTAX]],
      ['declare function now(): number;\nexport const p = now();\n', [SYNTAX]],
      ['declare class Clock { now(): number }\nexport const p = new Clock().now();\n', [SYNTAX]],
      ['declare enum E { A }\nexport const p = E.A;\n', [SYNTAX]],
      ['declare global { const T: number }\nexport const p = 1;\n', [SYNTAX]],
      ['declare namespace N { const t: number }\nexport const p = N.t;\n', [SYNTAX]],
      ["declare module 'x' { const t: number }\nexport const p = 1;\n", [SYNTAX]],
    ]);
  });

  it('Temporal is a restricted global (a clock and a time-zone database)', async () => {
    await expectCaught([
      ['export const p = (): unknown => Temporal;\n', ['no-restricted-globals']],
      ['export const p = (): unknown => globalThis.Temporal;\n', ['no-restricted-properties']],
    ]);
  });

  it('control: function overloads, class constructors and plain shadowing names pass', async () => {
    const code = [
      'export function f(a: string): string;',
      'export function f(a: number): number;',
      'export function f(a: string | number): string | number {',
      '  return a;',
      '}',
      'export class E extends Error {',
      '  constructor(readonly code: string) {',
      '    super(code);',
      '  }',
      '}',
      'export const g = (window: number): number => window + 1;',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });
});

describe('no constructor reached from a value, no Symbol.toPrimitive (PI-3, PI-4)', () => {
  it('.constructor in every spelling fails', async () => {
    await expectCaught([
      ['export const p = (): number => (new Date(0).constructor as DateConstructor).now();\n', [SYNTAX]],
      [
        'const D = Object.getPrototypeOf(new Date(0)) as Date;\nexport const p = (): number => (D.constructor as DateConstructor).now();\n',
        [SYNTAX],
      ],
      [
        "export const p = (): number => (Reflect.get(new Date(0).constructor, 'now') as () => number)();\n",
        [SYNTAX],
      ],
      [
        "const KEY = 'constructor';\nexport const p = (): number => (new Date(0)[KEY] as DateConstructor).now();\n",
        [SYNTAX],
      ],
      ["export const p = (o: object): unknown => Reflect.get(o, 'constructor');\n", [SYNTAX]],
      ["export const p = (o: Record<string, unknown>): unknown => o['constructor'];\n", [SYNTAX]],
      ['export const p = (o: Record<string, unknown>): unknown => o[`constructor`];\n', [SYNTAX]],
      [
        "export const p = (): unknown => ([].constructor.constructor as FunctionConstructor)('return 1')();\n",
        [SYNTAX],
      ],
    ]);
  });

  it('Symbol.toPrimitive fails, called or held', async () => {
    await expectCaught([
      ["export const p = (ms: number): string => new Date(ms)[Symbol.toPrimitive]('string');\n", [SYNTAX]],
      ['export const K = Symbol.toPrimitive;\n', [SYNTAX]],
    ]);
  });
});

const CONSTRUCTOR = 'src/core is pure: no `.constructor`';

describe('no constructor reached by destructuring (UNI-R3-3)', () => {
  it.each([
    'const { constructor } = /a/;\nexport const kind = typeof constructor;\n',
    'const { constructor: found }: { constructor: unknown } = /a/;\nexport const f = found;\n',
    'const { constructor: found }: { constructor: unknown } = new Date(0);\nexport const f = found;\n',
    "const { ['constructor']: found }: { constructor: unknown } = new Date(0);\nexport const f = found;\n",
  ])('%s fails with the constructor message', async (code) => {
    const found = await messages(code);
    expect(found.map((m) => m.message).join('\n')).toContain(CONSTRUCTOR);
  });
});

describe('no error stacks, stack API or import.meta (FR3-3)', () => {
  it('each spelling fails', async () => {
    await expectCaught([
      ["export const q05 = (): string => new Error('probe').stack ?? '';\n", [SYNTAX]],
      ['export const { stack } = new Error();\n', [SYNTAX]],
      ["export const s = (e: Error): unknown => e['stack'];\n", [SYNTAX]],
      ["export const r = (): unknown => Reflect.get(Error, 'stackTraceLimit');\n", [SYNTAX]],
      ['export const c = (): unknown => Error.captureStackTrace;\n', [SYNTAX]],
      ['export const p = (): unknown => Error.prepareStackTrace;\n', [SYNTAX]],
      ["export const u = (): unknown => Reflect.get(import.meta, 'url');\n", [SYNTAX]],
    ]);
  });
});

describe('no reflection or mutation of built-ins (FR3-2)', () => {
  it('reflective and mutating Reflect and Object members, aliasing and computed keys fail', async () => {
    await expectCaught([
      ['export const f = (g: () => number): unknown => Reflect.apply(g, undefined, []);\n', [DETERMINISM]],
      ["Reflect.set(Error, 'stackTraceLimit', 0);\n", [DETERMINISM, SYNTAX]],
      ['export const k = (o: object): unknown => Reflect.ownKeys(o);\n', [DETERMINISM]],
      ['export const p = (o: object): unknown => Reflect.getPrototypeOf(o);\n', [DETERMINISM]],
      ['const R = Reflect;\nexport const g = (o: object): unknown => R.get(o, "k");\n', [DETERMINISM]],
      ['const { apply } = Reflect;\nexport const g = apply;\n', [DETERMINISM, SYNTAX]],
      ["export const g = (o: object): unknown => Reflect['apply'];\n", [DETERMINISM, SYNTAX]],
      ['export const n = (o: object): string[] => Object.getOwnPropertyNames(o);\n', [DETERMINISM]],
      ["Object.defineProperty(Array.prototype, 'probe', { value: 1 });\n", [DETERMINISM, SYNTAX]],
      ['export const a = (o: object): object => Object.assign(o, { a: 1 });\n', [DETERMINISM]],
      ['export const s = (o: object): object => Object.setPrototypeOf(o, null);\n', [DETERMINISM]],
      ['const O = Object;\nexport const d = O;\n', [DETERMINISM]],
      ['export const c = (g: (x: number) => number): number => g.call(undefined, 1);\n', [SYNTAX]],
      ['export const b = (g: (x: number) => number): unknown => g.bind(undefined);\n', [SYNTAX]],
      ['export const p = (): unknown => Number.prototype;\n', [SYNTAX]],
      ["export const p = (o: object): unknown => Reflect.get(o, '__proto__');\n", [SYNTAX]],
    ]);
  });

  it('Reflect.get and Object.getOwnPropertyDescriptor take a written key, and it is read like a member', async () => {
    await expectCaught([
      ["export const q03 = Reflect.get(Math, 'toLocale' + 'String');\n", [DETERMINISM]],
      ['export const g = (o: object, k: () => string): unknown => Reflect.get(o, k());\n', [DETERMINISM]],
      ['export const g = (o: object, k: string): unknown => Reflect.get(o, `${k}x`);\n', [DETERMINISM]],
      [
        "export const d = (o: object): unknown => Object.getOwnPropertyDescriptor(o, 'a' + 'b');\n",
        [DETERMINISM],
      ],
      ["export const z = (o: object): unknown => Reflect.get(o, 'getTimezoneOffset');\n", [DETERMINISM]],
      ["export const z = (o: object): unknown => Reflect.get(o, 'toLocaleString');\n", [DETERMINISM]],
    ]);
  });

  it('control: what src/core does with Reflect and Object today passes', async () => {
    const code = [
      "export const a = (o: object): unknown => Reflect.get(o, 'code');",
      'export const b = (o: object, name: string): unknown => Reflect.get(o, name);',
      'export const c = (o: object, key: string): unknown => Object.getOwnPropertyDescriptor(o, key);',
      'export const d = (v: object): boolean => Object.getPrototypeOf(v) === Object.prototype;',
      'export const e = (v: Record<string, number>) => [Object.keys(v), Object.entries(v), Object.values(v)];',
      'export const f = Object.freeze({ a: 1 });',
      "export const g = (v: object): boolean => Object.is(v, -0) || Object.hasOwn(v, 'k');",
      "export const h = Object.fromEntries([['a', 1]]);",
      'export const i = (v: unknown): boolean => v instanceof Object;',
      "export const j = (o: object): boolean => Reflect.has(o, 'k');",
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });
});
