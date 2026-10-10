/**
 * Sprint 0.8 Done-when: "no threshold exists anywhere in code" (ledger_engineer rule 2, Hard Rule 4).
 *
 * Walks the TypeScript AST of every TS/JS source file (.ts .tsx .mts .cts .js .jsx .mjs .cjs) under
 * extension/src and extension/entrypoints and fails if a numeric literal, or a string literal that
 * parses as a number (`Number('0.85')`), equals any fractional value in policy/default.json
 * (thresholds, weights, signal scores: the set is computed from the JSON, never hardcoded here).
 * src/core is held to a stricter rule: no such literal other than 0 and 1 at all, so a magic number
 * cannot hide there, and the only JSON module core may import is policy/default.json, so a second
 * data file cannot smuggle thresholds in either.
 */
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';

const EXTENSION_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCANNED_DIRS = ['src', 'entrypoints'].map((dir) => path.join(EXTENSION_ROOT, dir));
const CORE_DIR = path.join(EXTENSION_ROOT, 'src', 'core');
const POLICY_FILE = path.resolve(EXTENSION_ROOT, '..', 'policy', 'default.json');
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/**
 * The only numeric literals src/core may contain: 0 and 1 are identities and the unit-interval bounds.
 * Extend this only if you must, with a comment here saying which file needs the value and why it is
 * not policy (e.g. a unit conversion), never for a threshold, window, or weight.
 */
const CORE_ALLOWED_LITERALS: ReadonlySet<number> = new Set([0, 1]);

/**
 * The only src/core files that may hold other integer literals, each because it implements a published
 * algorithm or names units and schema limits, never a threshold, window or weight. Every other core file
 * imports these names (docs/grading.md §13–14, Decisions.md [1.contract]). The policy-fraction rule
 * above still applies to these files: no exemption from it exists anywhere.
 */
const CORE_LITERAL_EXEMPT: Readonly<Record<string, string>> = {
  [path.join('src', 'core', 'sha256.ts')]: 'FIPS 180-4 constants and rotations; RFC 3629 UTF-8 encoding',
  [path.join('src', 'core', 'base32.ts')]: 'Crockford base32 alphabet width and the 26-character ULID form',
  [path.join('src', 'core', 'punycode.ts')]: 'RFC 3492 bootstring parameters',
  [path.join('src', 'core', 'units.ts')]:
    'named unit conversions: ms per minute/hour/day, cents, basis points',
  [path.join('src', 'core', 'schema-primitives.ts')]:
    'SCHEMA_LIMITS length caps and build_spec §7 field limits',
};

interface NumericLiteral {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly value: number;
}

/** Every fractional number anywhere in the policy document. */
function policyFractions(value: unknown, found = new Set<number>()): Set<number> {
  if (typeof value === 'number' && !Number.isInteger(value)) found.add(value);
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child: unknown) => policyFractions(child, found));
  }
  return found;
}

/** The number a literal node spells: a numeric or bigint literal, or a string that parses as one. */
function literalValue(node: ts.Node): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isBigIntLiteral(node)) return Number(node.text.slice(0, -1));
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const text = node.text.trim();
    const value = Number(text);
    return text !== '' && Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

/** The script kind is inferred from the file extension (.tsx → TSX, .mjs → JS, …). */
function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

function numericLiterals(fileName: string, source: string): NumericLiteral[] {
  const sourceFile = parse(fileName, source);
  const found: NumericLiteral[] = [];
  const visit = (node: ts.Node): void => {
    const value = literalValue(node);
    if (value !== undefined) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({ file: fileName, line: line + 1, text: node.getText(sourceFile), value });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Module specifiers of every static import / re-export that names a .json file. */
function jsonImports(fileName: string, source: string): string[] {
  return parse(fileName, source)
    .statements.flatMap((statement) =>
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [],
    )
    .filter((specifier) => specifier.endsWith('.json'));
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => SOURCE_FILE.test(entry) && !entry.split(path.sep).includes('node_modules'))
    .map((entry) => path.join(dir, entry))
    .sort();
}

function scan(files: readonly string[]): NumericLiteral[] {
  return files.flatMap((file) =>
    numericLiterals(path.relative(EXTENSION_ROOT, file), fs.readFileSync(file, 'utf8')),
  );
}

const describeHit = (hit: NumericLiteral): string => `${hit.file}:${hit.line} ${hit.text}`;

const FRACTIONS = policyFractions(policyJson);
const ALL_FILES = SCANNED_DIRS.flatMap(sourceFiles);
const CORE_FILES = sourceFiles(CORE_DIR);

describe('no policy value is hardcoded in code', () => {
  it('the policy has fractional values to look for (computed from the JSON)', () => {
    expect(FRACTIONS.has(policyJson.thresholds.verified)).toBe(true);
    expect(FRACTIONS.has(policyJson.unasked.threshold)).toBe(true);
    expect(FRACTIONS.size).toBeGreaterThan(Object.keys(policyJson.features).length / 2);
  });

  it('the scanner sees the real source tree, and every TS/JS extension', () => {
    const relative = ALL_FILES.map((file) => path.relative(EXTENSION_ROOT, file));
    expect(relative).toContain(path.join('src', 'core', 'policy.ts'));
    expect(relative).toContain(path.join('src', 'config.ts'));
    expect(relative).toContain(path.join('entrypoints', 'background.ts'));
    const extensions = ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.d.ts'];
    expect(extensions.filter((name) => !SOURCE_FILE.test(name))).toEqual([]);
    expect(['a.json', 'a.css', 'a.html', 'a.md'].filter((name) => SOURCE_FILE.test(name))).toEqual([]);
  });

  it('the scanner catches a planted threshold, however it is written', () => {
    const { verified, partial } = policyJson.thresholds;
    const probe = [
      `if (score >= ${verified}) grade = 'VERIFIED';`,
      `const floor = -${partial};`,
      `const w: number = ${String(policyJson.features.counterpartyExact).replace(/^0/, '')};`,
      `const parsed = Number('${verified}') + parseFloat(\`${partial}\`);`,
      `const exp = ${verified.toExponential()};`,
    ].join('\n');
    const hits = numericLiterals('probe.ts', probe).filter((hit) => FRACTIONS.has(hit.value));
    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 4, 4, 5]);
    expect(numericLiterals('probe.tsx', 'const el = <div tabIndex={2} />;').map((hit) => hit.value)).toEqual([
      2,
    ]);
    const js = numericLiterals('probe.mjs', `export const t = ${verified};`);
    expect(js.map((hit) => hit.value)).toEqual([verified]);
  });

  it('ordinary strings are not mistaken for numbers', () => {
    const probe = "const a = ''; const b = ' '; const c = 'v1.2.0'; const d = 'opacity-50'; const e = 'NaN';";
    expect(numericLiterals('probe.ts', probe)).toEqual([]);
  });

  it('no source file under src/ or entrypoints/ contains a policy fraction', () => {
    const offenders = scan(ALL_FILES).filter((hit) => FRACTIONS.has(hit.value));
    expect(offenders.map(describeHit)).toEqual([]);
  });
});

describe('src/core holds no magic number and imports no other data file', () => {
  it('src/core contains no numeric literal other than 0 and 1 (outside the named exemptions)', () => {
    expect(CORE_FILES.length).toBeGreaterThan(0);
    const checked = CORE_FILES.filter(
      (file) => !(path.relative(EXTENSION_ROOT, file) in CORE_LITERAL_EXEMPT),
    );
    const offenders = scan(checked).filter((hit) => !CORE_ALLOWED_LITERALS.has(hit.value));
    expect(offenders.map(describeHit)).toEqual([]);
  });

  it('every literal exemption names a reason and lives directly in src/core', () => {
    for (const [file, reason] of Object.entries(CORE_LITERAL_EXEMPT)) {
      expect(path.dirname(file)).toBe(path.join('src', 'core'));
      expect(reason.length).toBeGreaterThan(20);
    }
    expect(Object.keys(CORE_LITERAL_EXEMPT)).not.toContain(path.join('src', 'core', 'grade.ts'));
    expect(Object.keys(CORE_LITERAL_EXEMPT)).not.toContain(path.join('src', 'core', 'features.ts'));
  });

  it('the core rule would catch a magic integer or fraction', () => {
    const probe =
      "const graceMs = 30 * 60_000;\nconst floor = 0.7;\nconst big = 10n;\nconst ok = [0, 1];\nconst s = Number('45');";
    const offenders = numericLiterals('src/core/probe.ts', probe).filter(
      (hit) => !CORE_ALLOWED_LITERALS.has(hit.value),
    );
    expect(offenders.map((hit) => hit.value)).toEqual([30, 60000, 0.7, 10, 45]);
  });

  it('the only JSON module src/core imports is policy/default.json', () => {
    const imported = CORE_FILES.flatMap((file) =>
      jsonImports(file, fs.readFileSync(file, 'utf8')).map((specifier) =>
        path.resolve(path.dirname(file), specifier),
      ),
    );
    expect(imported).toContain(POLICY_FILE);
    expect(imported.filter((file) => file !== POLICY_FILE)).toEqual([]);
  });

  it('the JSON-import rule sees imports and re-exports', () => {
    const probe =
      "import a from './weights.json';\nexport { default as b } from '../x/thresholds.json';\nimport { z } from 'zod';";
    expect(jsonImports('src/core/probe.ts', probe)).toEqual(['./weights.json', '../x/thresholds.json']);
  });
});
