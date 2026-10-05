/**
 * The service worker and the ledger load no Calendar page code (TECH-7; TECH-V3; Hard Rule 6). They share the
 * Calendar snapshot schema and diff with the observer (src/observers/gcal/snapshot.ts, diff.ts, days.ts, errors.ts),
 * which read no selectors and no DOM. If they imported the observer's selectors, background.js would parse
 * selectors.json at start-up, and a selectors file that failed its schema (a slip while repairing selectors) would
 * throw before the bus listener and the alarms are registered, stopping every observer and the purge.
 *
 * The test walks the static import graph from the background entrypoint and from every ledger module, as a bundler
 * would (`import type` and `export type` load nothing), and checks which observer modules it reaches.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const GCAL = path.join(ROOT, 'src/observers/gcal');
/** The Calendar modules the worker may load: no selectors, no DOM, no clock. */
const SHARED = ['days.ts', 'diff.ts', 'errors.ts', 'snapshot.ts'].map((file) => path.join(GCAL, file));

/** The file a relative specifier names, as the bundler resolves it; null for a package. */
function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  const found = candidates.find((file) => existsSync(file) && !file.endsWith(path.sep) && path.extname(file));
  if (found === undefined) throw new Error(`${path.relative(ROOT, from)}: cannot resolve ${specifier}`);
  return found;
}

/** The module specifiers `file` loads when it runs (type-only imports and exports load nothing). */
function loads(file: string): string[] {
  if (!/\.tsx?$/.test(file)) return [];
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments;
      if (first !== undefined && ts.isStringLiteral(first)) specifiers.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** Every file the roots load, transitively. */
function reached(roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of loads(file)) {
      const target = resolve(file, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const LEDGER = readdirSync(path.join(ROOT, 'src/ledger'))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => path.join(ROOT, 'src/ledger', name));
const WORKER = reached([path.join(ROOT, 'entrypoints/background.ts'), ...LEDGER]);

/** `file`'s code without its comments. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the service worker and the ledger load no Calendar page code (TECH-7)', () => {
  it('they reach the Calendar snapshot schema and diff, and no other Calendar observer module', () => {
    const gcal = [...WORKER].filter((file) => file.startsWith(`${GCAL}${path.sep}`)).sort();
    expect(gcal.map((file) => path.relative(ROOT, file))).toEqual(
      SHARED.map((file) => path.relative(ROOT, file)),
    );
    expect(WORKER.has(path.join(GCAL, 'selectors.json'))).toBe(false);
    expect(WORKER.has(path.join(GCAL, 'selectors.ts'))).toBe(false);
  });

  it('no observer module they reach reads the page (no document, window or element query)', () => {
    const observers = [...WORKER].filter((file) =>
      file.includes(`${path.sep}src${path.sep}observers${path.sep}`),
    );
    expect(observers.length).toBeGreaterThan(0);
    for (const file of observers) {
      expect(codeOf(file), path.relative(ROOT, file)).not.toMatch(
        /\bdocument\b|\bwindow\b|querySelector|getAttribute/,
      );
    }
  });

  it('the walk sees the imports it must: the background entry reaches the Calendar pass and the bus schema', () => {
    for (const file of [
      'src/background/calendar-pass.ts',
      'src/bus/messages.ts',
      'src/ledger/calendar-snapshots.ts',
    ])
      expect(WORKER.has(path.join(ROOT, file)), file).toBe(true);
  });
});
