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
 * Each file is reduced to its code with the TypeScript scanner: comments, string literals, template text and
 * regular-expression literals become spaces, so prose such as "never calls Date.now()" is not a hit and a call
 * hidden after a string is still found. Banned patterns are matched on what remains. Imports are read with
 * ts.preProcessFile (static, type-only, re-exports, dynamic import(), require) and checked against the allowlist:
 * a sibling module that exists in src/core, `zod`, and policy/default.json. Negative controls prove every pattern
 * and the allowlist catch what they claim, and that comments and strings are not hits.
 */
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

/** Clock, randomness, timers, network, host and garbage-collector APIs, matched on code only. */
const BANNED: readonly (readonly [string, RegExp])[] = [
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date() with no argument', /\bnew\s+Date\s*\(\s*\)/],
  ['new Date without parentheses', /\bnew\s+Date\b(?!\s*\()/],
  ['Date() called as a function', /(?<![\w$.]|\bnew\s+)\bDate\s*\(/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['getRandomValues', /\bgetRandomValues\b/],
  ['randomUUID', /\brandomUUID\b/],
  ['fetch', /\bfetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['performance', /\bperformance\b/],
  ['setTimeout / setInterval / setImmediate', /\bset(?:Timeout|Interval|Immediate)\b/],
  ['process.', /(?<![\w$.])process\s*\./],
  ['Intl', /\bIntl\b/],
  ['WeakRef', /\bWeakRef\b/],
  ['FinalizationRegistry', /\bFinalizationRegistry\b/],
  ['crypto', /(?<![\w$.])crypto\s*\./],
  ['chrome', /(?<![\w$.])chrome\s*\./],
];

const K = ts.SyntaxKind;

/** Tokens that become spaces: they hold text, not code. */
const TEXT_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  K.SingleLineCommentTrivia,
  K.MultiLineCommentTrivia,
  K.ShebangTrivia,
  K.StringLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateHead,
  K.TemplateMiddle,
  K.TemplateTail,
  K.RegularExpressionLiteral,
]);

const TRIVIA: ReadonlySet<ts.SyntaxKind> = new Set([
  K.WhitespaceTrivia,
  K.NewLineTrivia,
  K.SingleLineCommentTrivia,
  K.MultiLineCommentTrivia,
  K.ShebangTrivia,
  K.ConflictMarkerTrivia,
]);

/** After these a `/` divides; after anything else it starts a regular expression literal. */
const ENDS_OPERAND: ReadonlySet<ts.SyntaxKind> = new Set([
  K.Identifier,
  K.PrivateIdentifier,
  K.NumericLiteral,
  K.BigIntLiteral,
  K.StringLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateTail,
  K.RegularExpressionLiteral,
  K.CloseParenToken,
  K.CloseBracketToken,
  K.CloseBraceToken,
  K.PlusPlusToken,
  K.MinusMinusToken,
  K.ThisKeyword,
  K.SuperKeyword,
  K.TrueKeyword,
  K.FalseKeyword,
  K.NullKeyword,
]);

/** The next token, re-scanned where the scanner alone cannot tell (template continuations, regex literals). */
function nextToken(scanner: ts.Scanner, braces: string[], previous: ts.SyntaxKind): ts.SyntaxKind {
  let kind = scanner.scan();
  if (kind === K.CloseBraceToken && braces.at(-1) === '${') {
    braces.pop();
    kind = scanner.reScanTemplateToken(false);
    if (kind === K.TemplateMiddle) braces.push('${');
  } else if (kind === K.OpenBraceToken) braces.push('{');
  else if (kind === K.CloseBraceToken) braces.pop();
  else if (kind === K.TemplateHead) braces.push('${');
  else if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && !ENDS_OPERAND.has(previous)) {
    kind = scanner.reScanSlashToken();
  }
  return kind;
}

/** `source` with every comment, string, template text and regex literal replaced by spaces (lines kept). */
function codeOnly(source: string): string {
  const out = source.split('');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const braces: string[] = [];
  let previous: ts.SyntaxKind = K.Unknown;
  for (let kind = nextToken(scanner, braces, previous); kind !== K.EndOfFileToken;) {
    if (TEXT_TOKENS.has(kind)) {
      for (let i = scanner.getTokenStart(); i < scanner.getTokenEnd(); i += 1)
        if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    }
    if (!TRIVIA.has(kind)) previous = kind;
    kind = nextToken(scanner, braces, previous);
  }
  return out.join('');
}

/** Each banned pattern found in `source`'s code, as `line N: name`. */
function bannedUses(source: string): string[] {
  const lines = codeOnly(source).split('\n');
  return lines.flatMap((line, index) =>
    BANNED.filter(([, pattern]) => pattern.test(line)).map(([name]) => `line ${String(index + 1)}: ${name}`),
  );
}

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
    ['setTimeout(() => undefined, 1);', 'setTimeout / setInterval / setImmediate'],
    ['setInterval(() => undefined, 1);', 'setTimeout / setInterval / setImmediate'],
    ['export const e = process.env.TZ;', 'process.'],
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
