/**
 * One suite-wide test timeout (vitest.config.ts TEST_TIMEOUT_MS, 60 s; TECH-R3). No unit, property or golden test
 * restates or shortens it: a timeout at or under 60 s is noise at best, and at worst a load-dependent failure with
 * no defect (qa_tester rule 10). A test that needs longer says so itself, with a literal or a file constant above
 * 60 s (the 120 s, 300 s and 600 s properties). Hooks keep their own timeouts: Vitest's hookTimeout is separate.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { TEST_TIMEOUT_MS } from '../../../vitest.config';

const TESTS = path.resolve(import.meta.dirname, '../..');
const TEST_CALLS = new Set(['it', 'test', 'describe']);

interface Timeout {
  readonly where: string;
  readonly text: string;
  /** The timeout in ms, or undefined when it is not a literal or a file-level numeric constant. */
  readonly ms: number | undefined;
}

/** The file-level constants a timeout may name: numbers, and option objects (`const GATE = { … }`). */
interface Constants {
  readonly numbers: ReadonlyMap<string, number>;
  readonly objects: ReadonlyMap<string, ts.ObjectLiteralExpression>;
}

/** `it`, `it.each([…])`, `describe.skip`, …: the identifier a test call starts from. */
function callee(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) || ts.isCallExpression(expression))
    return callee(expression.expression);
  return undefined;
}

/** A numeric literal, or a product of them (`5 * 60_000`). */
function numberOf(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
    const [left, right] = [numberOf(node.left), numberOf(node.right)];
    return left === undefined || right === undefined ? undefined : left * right;
  }
  return undefined;
}

function constantsOf(file: ts.SourceFile): Constants {
  const numbers = new Map<string, number>();
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const { name, initializer } of statement.declarationList.declarations) {
      if (!ts.isIdentifier(name) || initializer === undefined) continue;
      const value = numberOf(initializer);
      if (value !== undefined) numbers.set(name.text, value);
      if (ts.isObjectLiteralExpression(initializer)) objects.set(name.text, initializer);
    }
  }
  return { numbers, objects };
}

/** The timeout arguments of a test call: a value after the callback, or `timeout` in an options object. */
function timeoutArguments(call: ts.CallExpression, constants: Constants): ts.Expression[] {
  const args = [...call.arguments];
  const optionsOf = (arg: ts.Expression): ts.ObjectLiteralExpression | undefined =>
    ts.isObjectLiteralExpression(arg)
      ? arg
      : ts.isIdentifier(arg)
        ? constants.objects.get(arg.text)
        : undefined;
  const objects = args.flatMap((arg) => optionsOf(arg) ?? []);
  const options = objects.flatMap((object) =>
    object.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) && property.name.getText() === 'timeout'
        ? [property.initializer]
        : [],
    ),
  );
  const last = args.at(-1);
  const positional =
    args.length >= 3 && last !== undefined && !ts.isFunctionLike(last) && optionsOf(last) === undefined
      ? [last]
      : [];
  return [...positional, ...options];
}

/** Every timeout a test call in `source` sets. */
function timeoutsIn(fileName: string, source: string): Timeout[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const constants = constantsOf(file);
  const found: Timeout[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && TEST_CALLS.has(callee(node.expression) ?? '')) {
      for (const arg of timeoutArguments(node, constants)) {
        const line = file.getLineAndCharacterOfPosition(arg.getStart(file)).line + 1;
        const ms = ts.isIdentifier(arg) ? constants.numbers.get(arg.text) : numberOf(arg);
        found.push({ where: `${fileName}:${String(line)}`, text: arg.getText(file), ms });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return /\.spec\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The timeouts that restate or shorten the suite-wide one, or that cannot be read. */
const offending = (timeouts: readonly Timeout[]): string[] =>
  timeouts
    .filter(({ ms }) => ms === undefined || ms <= TEST_TIMEOUT_MS)
    .map(({ where, text }) => `${where} ${text}`);

describe('test timeouts: one suite-wide bound (TECH-R3)', () => {
  const files = ['unit', 'property', 'golden'].flatMap((dir) => specFiles(path.join(TESTS, dir)));
  const all = files.flatMap((file) => timeoutsIn(path.relative(TESTS, file), readFileSync(file, 'utf8')));

  it('no unit, property or golden test sets a timeout of 60 s or less', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(offending(all)).toEqual([]);
  });

  it('the longer ones are still read: the 600 s replay properties', () => {
    const replay = all.filter(({ where }) => where.startsWith(path.join('property', 'replay.property')));
    expect(replay.length).toBeGreaterThan(0);
    for (const { ms } of replay) expect(ms).toBe(600_000);
  });

  it('the scanner sees a timeout however it is written', () => {
    const probe = [
      'const SHORT = 30_000;',
      'const LONG = 5 * 120_000;',
      'const DYNAMIC = Number(process.env.T);',
      "const OPTIONS = { tags: ['gate'], timeout: 10_000 };",
      "it('a', () => {}, 60_000);",
      "it('b', () => {}, SHORT);",
      "test('c', { timeout: 5_000 }, () => {});",
      "describe.each([1])('d %s', () => {}, 1000);",
      "it.skip('e', async () => {}, 600_000);",
      "it('f', () => {}, LONG);",
      "it('g', () => {}, DYNAMIC);",
      "describe('h', OPTIONS, () => {});",
      "it('i', () => { setTimeout(() => {}, 10); });",
    ].join('\n');
    expect(offending(timeoutsIn('probe.spec.ts', probe))).toEqual([
      'probe.spec.ts:5 60_000',
      'probe.spec.ts:6 SHORT',
      'probe.spec.ts:7 5_000',
      'probe.spec.ts:8 1000',
      'probe.spec.ts:11 DYNAMIC',
      'probe.spec.ts:4 10_000',
    ]);
  });
});
