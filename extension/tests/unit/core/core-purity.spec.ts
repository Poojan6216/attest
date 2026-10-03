/**
 * @gate Sprint 1 — the grep test over src/core (sprint_1.md header and Gate: "lint + grep test for
 * Date.now|Math.random|crypto.getRandomValues|fetch"; TECH-R1, QA-R7; Hard Rule 4: grade() is pure and
 * deterministic). Tagged `gate` (vitest.config.ts TEST_TAGS): select it with `vitest run --tags-filter gate`.
 *
 * Lint (eslint-rules/core-fences.js, attest/core-determinism) fences src/core already. This test is the second,
 * independent check the Gate names: it reads the real files on disk, so a lint regression (a misspelled glob, an
 * override or ignores entry that names a core file, a rule scoped away) cannot let a clock, randomness, the network
 * or an impure import into src/core unnoticed by `pnpm test`.
 *
 * The scanner (./core-scan.ts) reduces each file to its code with the TypeScript scanner, so comments and strings
 * are not hits; it reads a member with a written key (`Date['now']`) as `Date.now`, and matches over the whole file,
 * so a call split across lines is still found (PI-6); it reads a global through `(X)`, `(0, X)`, `[X][0]` and `X!`,
 * and a `/` after any property name as division (FR3-5). It needs no lint and no types: computed keys, `globalThis`
 * and `Reflect` reads, a spread or multi-field `new Date`, ambient declarations, `.constructor` (destructured too),
 * `Symbol.toPrimitive`, local-time and locale methods, error stacks, `import.meta`, and reflection or mutation of
 * built-ins are all its own patterns (PI-1 to PI-4, PI-6, FR3-2, FR3-3, UNI-R3-3). The globals it allows are lint's
 * own allowlist of ES2023 built-ins (./core-scan-globals.ts, FS-1, R4-FENCE-1), proven in core-purity-globals.spec.ts
 * and core-purity-allowlist.spec.ts, with the comments that switch the typecheck off. Imports are read with
 * ts.preProcessFile (static, type-only, re-exports, dynamic import(), require) and checked against the allowlist: a
 * sibling module that exists in src/core, `zod`, and policy/default.json. Negative controls prove every pattern and
 * the allowlist catch what they claim, and that comments and strings are not hits. tests/unit/core/core-poison.spec.ts
 * is the third check: it runs the core with every impure global poisoned, whatever the syntax that reaches it (and
 * `pnpm test:poison` runs every core, golden and property test that way). Deliberately evasive code (a name built
 * from fragments, a reflection chain built to dodge the patterns) is a review matter: docs/grading.md §14 lists it.
 */
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { bannedUses, codeOnly } from './core-scan';

const EXTENSION_ROOT = path.resolve(import.meta.dirname, '../../..');
const CORE_DIR = path.join(EXTENSION_ROOT, 'src', 'core');
const POLICY_FILE = path.resolve(EXTENSION_ROOT, '..', 'policy', 'default.json');

/**
 * Source files in src/core at the Sprint 1 close (60 committed before it, 67 after its fixes; raise it as files
 * are added). A wrong path, an empty walk or a walk that misses files cannot pass vacuously.
 */
const MIN_CORE_FILES = 67;

/** What may sit in src/core besides .ts sources (a .js or .mts file would otherwise escape this scan). */
const NON_SOURCE_FILES: ReadonlySet<string> = new Set(['tsconfig.json']);

/** Whether a module specifier in a src/core file is on the allowlist. */
function importAllowed(fileDir: string, specifier: string): boolean {
  if (specifier === 'zod') return true;
  if (path.resolve(fileDir, specifier) === POLICY_FILE) return true;
  return /^\.\/[a-z0-9-]+$/.test(specifier) && fs.existsSync(path.join(fileDir, `${specifier}.ts`));
}

/** Every module specifier `source` loads that is not on the allowlist (as if the file sat in `fileDir`). */
function disallowedImports(source: string, fileDir = CORE_DIR): string[] {
  const { importedFiles } = ts.preProcessFile(source, true, true);
  return importedFiles.map((ref) => ref.fileName).filter((specifier) => !importAllowed(fileDir, specifier));
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const ALL_CORE_FILES = walk(CORE_DIR);
const CORE_FILES = ALL_CORE_FILES.filter((file) => file.endsWith('.ts'));
const relative = (file: string) => path.relative(EXTENSION_ROOT, file);

const GATE = { tags: ['gate'] };

describe('src/core purity on the real files (@gate sprint 1: lint + grep test, Hard Rule 4)', GATE, () => {
  it(`walks every source file in src/core (at least ${String(MIN_CORE_FILES)}), and only .ts sources`, () => {
    expect(CORE_FILES.length).toBeGreaterThanOrEqual(MIN_CORE_FILES);
    const others = ALL_CORE_FILES.filter(
      (file) => !file.endsWith('.ts') && !NON_SOURCE_FILES.has(path.basename(file)),
    );
    expect(others.map(relative)).toEqual([]);
  });

  it('no file in src/core reads the clock, randomness, timers, the network, the host or the GC', () => {
    const offenders = CORE_FILES.flatMap((file) =>
      bannedUses(fs.readFileSync(file, 'utf8')).map((hit) => `${relative(file)} ${hit}`),
    );
    expect(offenders).toEqual([]);
  });

  it('no file in src/core imports anything but its own modules, zod and policy/default.json', () => {
    const offenders = CORE_FILES.flatMap((file) =>
      disallowedImports(fs.readFileSync(file, 'utf8'), path.dirname(file)).map(
        (specifier) => `${relative(file)} imports '${specifier}'`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the scan is not vacuous: code survives stripping, and the policy and zod imports are seen', () => {
    for (const file of CORE_FILES)
      expect(codeOnly(fs.readFileSync(file, 'utf8')), relative(file)).toMatch(/\bexport\b/);
    const specifiers = CORE_FILES.flatMap((file) =>
      ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true).importedFiles.map((ref) => ref.fileName),
    );
    expect(specifiers).toContain('zod');
    expect(specifiers).toContain('../../../policy/default.json');
    expect(specifiers.filter((specifier) => specifier.startsWith('./')).length).toBeGreaterThan(
      MIN_CORE_FILES,
    );
  });
});

describe('core purity scan: negative controls (each pattern is caught)', GATE, () => {
  it.each([
    ['export const t = Date.now();', 'Date.now'],
    ['export const t = Date . now ();', 'Date.now'],
    ['const { now } = Date; export const t = Date.now;', 'Date.now'],
    ['export const t = new Date();', 'new Date() with no argument'],
    ['export const t = new Date;', 'new Date without parentheses'],
    ['export const s = Date();', 'Date() called as a function'],
    ['export const r = Math.random();', 'Math.random'],
    ['export const b = crypto.getRandomValues(new Uint8Array(4));', 'getRandomValues'],
    ['export const id = globalThis.crypto.randomUUID();', 'randomUUID'],
    ["export const p = fetch('https://x');", 'fetch'],
    ['export const f = globalThis.fetch;', 'fetch'],
    ['export const x = new XMLHttpRequest();', 'XMLHttpRequest'],
    ["export const w = new WebSocket('wss://x');", 'WebSocket'],
    ['export const t = performance.now();', 'performance'],
    ['setTimeout(() => undefined, 1);', 'setTimeout'],
    ['setInterval(() => undefined, 1);', 'setInterval'],
    ['export const e = process.env.TZ;', 'process'],
    ['export const z = Intl.DateTimeFormat().resolvedOptions().timeZone;', 'Intl'],
    ['export const w = new WeakRef({});', 'WeakRef'],
    ['export const f = new FinalizationRegistry(() => undefined);', 'FinalizationRegistry'],
    ['export const s = crypto.subtle;', 'crypto'],
    ['export const id = chrome.runtime.id;', 'chrome'],
  ])('%s → %s', (code, name) => {
    expect(bannedUses(code)).toContain(`line 1: ${name}`);
  });

  it('a banned call after a string, a template, a regex or a comment on the same line is still caught', () => {
    for (const code of [
      "const s = 'x'; export const t = Date.now();",
      'const s = `a${String(1)}b`; export const t = Date.now();',
      'const r = /[/]/g; export const t = Date.now();',
      'const q = 4 / 2 / 1; export const t = Date.now();',
      '/* note */ export const t = Date.now();',
    ]) {
      expect(bannedUses(code), code).toEqual(['line 1: Date.now']);
    }
    expect(bannedUses('export const t = `${String(Date.now())}`;')).toEqual(['line 1: Date.now']);
  });
});

/**
 * The bypasses found after the Sprint 1 close, each with every name the scan must report for it: written keys,
 * `globalThis`/`self`/`Reflect`, calls split across lines (PI-6), a spread, multi-field or text `new Date` (PI-1),
 * ambient declarations and Temporal (PI-2), `.constructor` in every spelling (PI-3) and `Symbol.toPrimitive` (PI-4).
 */
const BYPASSES: readonly (readonly [string, readonly string[]])[] = [
  ["export const t = Date['now']();", ['Date.now']],
  ['export const t = Date[`now`]();', ['Date.now']],
  ["export const t = Date?.['now']();", ['Date.now']],
  ["const k = 'random' as const; export const r = Math[k]();", ['computed member of Date, Math or crypto']],
  ["export const p = globalThis['fetch']('https://x.example');", ['fetch', 'globalThis']],
  ["export const p = Reflect.get(globalThis, 'performance');", ['globalThis', 'Reflect on a global']],
  ["export const n = (Reflect.get(Date, 'now') as () => number)();", ['Reflect on a global']],
  ['export const t = self.performance.now();', ['performance', 'self']],
  ['const g = globalThis;\nexport const i = g.Intl;', ['globalThis', 'Intl']],
  ['export const t = Date\n  .now();', ['Date.now']],
  ['export const r = Math\n  .random();', ['Math.random']],
  ['export const t = new\n  Date();', ['new Date() with no argument']],
  ['const none: [] = [];\nexport const t = new Date(...none);', ['new Date with a spread argument']],
  ['export const t = (y: number, m: number) => new Date(y, m, 1);', ['new Date with fields']],
  ['export const t = (y: number) => new Date(\n  y,\n  0,\n);', ['new Date with fields']],
  ["export const t = new Date('2026-01-01T00:00:00');", ['new Date from written text']],
  ['export const t = new Date(`2026-01-01`);', ['new Date from written text']],
  ['declare const Date: DateConstructor;', ['ambient declaration']],
  ['declare let Math: { random(): number };', ['ambient declaration']],
  ['declare function now(): number;', ['ambient declaration']],
  ['declare class Clock {}', ['ambient declaration']],
  ['declare global {\n  const T: number;\n}', ['ambient declaration']],
  ['declare namespace N {}', ['ambient declaration']],
  ["declare module 'x' {}", ['ambient declaration']],
  ['export const t = Temporal.Now.instant();', ['Temporal']],
  ['export const t = (new Date(0).constructor as DateConstructor).now();', ['.constructor']],
  ["export const t = Reflect.get(new Date(0), 'constructor');", ["'constructor' as a string"]],
  ["export const t = (d: Date) => d['constructor'];", ['.constructor', "'constructor' as a string"]],
  ["const KEY = 'constructor';", ["'constructor' as a string"]],
  ["export const s = (d: Date) => d[Symbol.toPrimitive]('string');", ['Symbol.toPrimitive']],
];

describe('core purity scan: the bypasses lint alone used to stop (PI-1 to PI-4, PI-6)', GATE, () => {
  it.each(BYPASSES)('%s', (code, names) => {
    const found = bannedUses(code).map((hit) => hit.replace(/^line \d+: /, ''));
    for (const name of names) expect(found, code).toContain(name);
  });

  it('a call split across lines is named by the line it starts on', () => {
    expect(bannedUses('const a = 1;\nexport const t = Date\n  .now();\n')).toEqual(['line 2: Date.now']);
    expect(
      bannedUses("const a = 1;\n\nexport const p = Reflect.get(\n  globalThis,\n  'fetch',\n);"),
    ).toEqual(['line 3: Reflect on a global', 'line 4: globalThis']);
  });

  it('control: one value in new Date, a class constructor, Date.UTC fields and look-alike names pass', () => {
    const code = [
      'export const a = (ms: number) => new Date(ms);',
      'export const b = (f: (x: number, y: number) => number) => new Date(f(1, 2));',
      'export const c = (ms: number) => new Date(\n  ms,\n);',
      'export class E extends Error {\n  constructor(readonly code: string) {\n    super(code);\n  }\n}',
      'export const d = Date.UTC(2026, 0, 1);',
      'export const e = (x: { itself: number; selfTest: number }) => x.itself + x.selfTest;',
      'export const f = (declare: number, global: number) => declare + global;',
      'export const g = (dates: readonly Date[]) => dates.length;',
      "export const h = Math.max(1, 2) + Number(Reflect.has({}, 'k'));",
    ].join('\n');
    expect(bannedUses(code)).toEqual([]);
  });
});

/** The verifier's destructured-constructor probes (UNI-R3-3), verbatim: the RegExp and the Date constructor. */
const CONSTRUCTOR_PROBES: Readonly<Record<string, string>> = {
  'zz-a7.ts': `function isRegExpConstructor(value: unknown): value is RegExpConstructor {
  return typeof value === 'function';
}
const { constructor: found }: { constructor: unknown } = /a/;
const Ctor = isRegExpConstructor(found) ? found : undefined;
export function folds(text: string, pattern: string): boolean {
  return Ctor !== undefined && new Ctor(pattern, 'iu').test(text);
}`,
  'zz-a9.ts': `type Clock = new () => { valueOf(): number };
function isClock(value: unknown): value is Clock {
  return typeof value === 'function';
}
const { constructor: found }: { constructor: unknown } = new Date(0);
export function nowMs(): number {
  return isClock(found) ? new found().valueOf() : 0;
}`,
  'zz-b5.ts': 'const { constructor } = /a/;\nexport const kind = typeof constructor;',
};

/**
 * The forms found by the third verification (UNI-R3-3, FR3-2, FR3-3, FR3-5), each with every name the scan must
 * report: a destructured constructor (the verifier's probes, as written), a global read through
 * `(X)`, `(0, X)`, `[X][0]`, `new (X)` or `X!`, a `/` after a keyword-named property (it divides; it does not start
 * a regex literal that would blank the code after it), host time-zone and locale methods on any value, error stacks
 * and the stack API, `import.meta`, and reflection or mutation of built-ins.
 */
const ROUND_THREE: readonly (readonly [string, readonly string[]])[] = [
  ['const { constructor } = /a/;', ['constructor destructured']],
  ['const { constructor: C }: { constructor: unknown } = new Date(0);', ['constructor destructured']],
  ['export const t = (Date).now();', ['Date.now']],
  ['export const r = (Math).random();', ['Math.random']],
  ['export const t = (0, Date).now();', ['Date.now']],
  ['export const t = [Date][0].now();', ['Date.now']],
  ['export const t = ((Date)).now();', ['Date.now']],
  ['export const t = Date!.now();', ['Date.now']],
  ['export const t = new (Date)();', ['new Date() with no argument']],
  ["export const n = (Reflect.get)(Date, 'now');", ['Reflect on a global']],
  ['export const a = (o: { type: number }) => o.type / Date.now() / 1;', ['Date.now']],
  ['export const a = (o: { default: number }) => o.default / Math.random() / 1;', ['Math.random']],
  ["export const a = (o: { from: number }) => o.from / Number(fetch('https://x.example')) / 1;", ['fetch']],
  [
    'export const a = (o: { of: number }) => o.of / new Date().getTime() / 1;',
    ['new Date() with no argument'],
  ],
  ['export const a = (x: number) => x! / Date.now() / 1;', ['Date.now']],
  ['export const o = (ms: number) => new Date(ms).getTimezoneOffset();', ['local-time or locale method']],
  ['export const h = (ms: number) => new Date(ms).getHours();', ['local-time or locale method']],
  ['export const l = (ms: number) => new Date(ms).toLocaleString();', ['local-time or locale method']],
  ['export const l = (n: number) => (n).toLocaleString();', ['local-time or locale method']],
  ['export const c = (a: string, b: string) => a.localeCompare(b);', ['local-time or locale method']],
  ['export const s = (ms: number) => new Date(ms).toString();', ['toString of a new Date']],
  ["export const s = new Error('probe').stack;", ['error stack or stack API']],
  ['export const { stack } = new Error();', ['stack API destructured']],
  ["export const k = Reflect.get(Error, 'captureStackTrace');", ["'captureStackTrace' as a string"]],
  ['export const u = import.meta.url;', ['import.meta']],
  ['export const p = Object.getPrototypeOf(new Date(0));', ['reflection on a new Date']],
  [
    'export const f = (g: () => number) => Reflect.apply(g, undefined, []);',
    ['Reflect other than get, has, isExtensible'],
  ],
  ['const R = Reflect;\nexport const f = R;', ['Reflect other than get, has, isExtensible']],
  ['export const n = (o: object) => Object.getOwnPropertyNames(o);', ['Object reflection or mutation']],
  [
    "Object.defineProperty(Array.prototype, 'probe', { value: 1 });",
    ['Object reflection or mutation', 'built-in .prototype or __proto__'],
  ],
  [
    "export const f = Reflect.get(Number.prototype, 'toLocale' + 'String');",
    ['built-in .prototype or __proto__'],
  ],
  ['export const f = (g: (x: number) => number) => g.call(undefined, 1);', ['.call / .apply / .bind']],
  ["export const f = (o: object) => Reflect.get(o, '__proto__');", ["'__proto__' as a string"]],
  ['export const f = (o: { __proto__: unknown }) => o.__proto__;', ['built-in .prototype or __proto__']],
  [
    'export const w = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);',
    ['Atomics', 'SharedArrayBuffer'],
  ],
];

describe(
  'core purity scan: the forms found by the third verification (FR3-2, FR3-3, FR3-5, UNI-R3-3)',
  GATE,
  () => {
    it.each(ROUND_THREE)('%s', (code, names) => {
      const found = bannedUses(code).map((hit) => hit.replace(/^line \d+: /, ''));
      for (const name of names) expect(found, code).toContain(name);
    });

    it.each(Object.entries(CONSTRUCTOR_PROBES))(
      'the destructured-constructor probe %s is caught',
      (_, code) => {
        expect(bannedUses(code).join('\n')).toContain('constructor destructured');
      },
    );

    it('control: division after keyword names, a regex after `!`, a class constructor and a local `stack` pass', () => {
      const code = [
        'export const a = (o: { type: number; of: number }) => o.type / 2 / o.of;',
        'export const b = (x: number) => x! / 2 / 1;',
        "export const c = !/a/.test('b') && /[/]/.test('c');",
        'export class E extends Error {\n  constructor(readonly code: string) {\n    super(code);\n  }\n}',
        'export const d = (x: number[]) => {\n  const stack = [...x];\n  return stack.length;\n};',
        'export const e = (f: (n: number) => number) => f(Date.UTC(2026, 0, 1)) + Math.max(1, 2);',
        "export const g = (o: object) => Reflect.get(o, 'code') ?? Object.getPrototypeOf(o) === Object.prototype;",
      ].join('\n');
      expect(bannedUses(code)).toEqual([]);
    });
  },
);

describe('core purity scan: controls (text is not code, legitimate code passes)', GATE, () => {
  it('a pattern in a comment, a string, a template or a regex literal is not a hit', () => {
    const code = [
      '// never call Date.now() or Math.random() here',
      '/** fetch, setTimeout and new Date() are banned */',
      "export const a = 'Date.now() Math.random() fetch(x) process.env';",
      'export const b = `performance.now() ${String(1)} Intl crypto.getRandomValues`;',
      'export const c = /Date\\.now|new Date\\(\\)/u;',
      'export const d = (n: number) => n / 2 / 1;',
    ].join('\n');
    expect(bannedUses(code)).toEqual([]);
  });

  it('dates from inputs, Date.UTC, instanceof Date and names that merely contain a banned word pass', () => {
    const code = [
      'export const t = (iso: string) => new Date(iso).getTime();',
      'export const u = Date.UTC(2026, 0, 1);',
      'export const isDate = (v: unknown) => v instanceof Date;',
      'export const prefetchCount = 1; export const reprocess = (x: { process: () => void }) => x.process();',
      'export const memo = new WeakMap<object, number>();',
    ].join('\n');
    expect(bannedUses(code)).toEqual([]);
  });
});

describe('core purity scan: the import allowlist', GATE, () => {
  it.each([
    ["import { nowIso } from '../clock';", '../clock'],
    ["import * as c from '../config';", '../config'],
    ["import { setup } from '../setup';", '../setup'],
    ["import type { Clock } from '../clock';", '../clock'],
    ["export * from '../ledger/db';", '../ledger/db'],
    ["export const m = import('../clock');", '../clock'],
    ["const c = require('../clock');", '../clock'],
    ["import c = require('../clock');", '../clock'],
    ["import { z } from 'zod/v4';", 'zod/v4'],
    ["import * as x from './sub/module';", './sub/module'],
    ["import * as x from './no-such-module';", './no-such-module'],
    ["import p from '../../policy/default.json';", '../../policy/default.json'],
    ["import w from './weights.json';", './weights.json'],
  ])('%s is reported', (code, specifier) => {
    expect(disallowedImports(code)).toEqual([specifier]);
  });

  it('control: sibling modules that exist, zod and the shipped policy are allowed', () => {
    const code = [
      "import { z } from 'zod';",
      "import type { Claim } from './schema';",
      "export { canonicalJson } from './hash';",
      "import defaultPolicyJson from '../../../policy/default.json';",
      "// import { nowIso } from '../clock';",
      'const s = "import x from \'../clock\'";',
    ].join('\n');
    expect(disallowedImports(code)).toEqual([]);
  });
});
