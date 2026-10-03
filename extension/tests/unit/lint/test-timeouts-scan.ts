/**
 * The syntactic scan behind tests/unit/lint/test-timeouts.spec.ts (TECH-R3, PI-8, FR3-7): every timeout a test or
 * suite call in a spec file sets, and every suite-wide bound it sets, read from the syntax tree. A value it cannot
 * read (an imported, shadowed, reassigned or mutated name, a spread of anything but a file-level object literal, a
 * key computed from a value) stands for its own value and counts as offending. The runtime check of each test's
 * timeout is ./test-timeout-setup.ts; this scan also finds a timeout that restates the suite-wide bound.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { TEST_TIMEOUT_MS } from '../../../vitest.config';

export const TESTS = path.resolve(import.meta.dirname, '../..');
/** Vitest's test and suite functions; a file adds every name it binds to one (`const t = it`, `test.extend(…)`). */
const TEST_CALLS: ReadonlySet<string> = new Set(['it', 'test', 'describe', 'suite']);

export interface Timeout {
  readonly where: string;
  readonly text: string;
  /** The timeout in ms, or undefined when it is not a literal or a file-level numeric constant. */
  readonly ms: number | undefined;
}

/**
 * The file-level constants a timeout may name: numbers, and option objects (`const GATE = { … }`). Only a name
 * declared once in the whole file, with `const` at file level, and never written (assigned, incremented, or a
 * property of it assigned) is read; any other name stands for its own value and is reported as unreadable (FR3-7).
 */
interface Constants {
  readonly numbers: ReadonlyMap<string, number>;
  readonly objects: ReadonlyMap<string, ts.ObjectLiteralExpression>;
  /** The names the file binds to a test or suite function, Vitest's own included. */
  readonly calls: ReadonlySet<string>;
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

/** The identifier an assignment, `++`/`--` or `delete` writes through (`X = …`, `X.timeout = …`, `X[k] += …`). */
function writtenRoot(node: ts.Node): string | undefined {
  let target: ts.Expression | undefined;
  const kind = ts.isBinaryExpression(node) ? node.operatorToken.kind : undefined;
  const assigns =
    kind !== undefined && kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
  if (assigns && ts.isBinaryExpression(node)) target = node.left;
  else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) target = node.operand;
  else if (ts.isDeleteExpression(node)) target = node.expression;
  while (
    target !== undefined &&
    (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))
  )
    target = target.expression;
  return target !== undefined && ts.isIdentifier(target) ? target.text : undefined;
}

/** How often each name is declared anywhere in `file`, and the names something writes. */
function bindingsOf(file: ts.SourceFile): { declared: Map<string, number>; written: Set<string> } {
  const declared = new Map<string, number>();
  const written = new Set<string>();
  const visit = (node: ts.Node): void => {
    const named = ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node);
    if (named && node.name !== undefined && ts.isIdentifier(node.name))
      declared.set(node.name.text, (declared.get(node.name.text) ?? 0) + 1);
    const root = writtenRoot(node);
    if (root !== undefined) written.add(root);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { declared, written };
}

/** The names `file` binds to a test or suite function: `const t = it`, `const myTest = test.extend({…})`. */
function testCallsOf(file: ts.SourceFile): Set<string> {
  const calls = new Set(TEST_CALLS);
  for (let grew = true; grew;) {
    grew = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        const from = callee(node.initializer);
        if (from !== undefined && calls.has(from) && !calls.has(node.name.text)) {
          calls.add(node.name.text);
          grew = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return calls;
}

function constantsOf(file: ts.SourceFile): Constants {
  const numbers = new Map<string, number>();
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const { declared, written } = bindingsOf(file);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const { name, initializer } of statement.declarationList.declarations) {
      if (!ts.isIdentifier(name) || initializer === undefined) continue;
      if (declared.get(name.text) !== 1 || written.has(name.text)) continue;
      const value = numberOf(initializer);
      if (value !== undefined) numbers.set(name.text, value);
      if (ts.isObjectLiteralExpression(initializer)) objects.set(name.text, initializer);
    }
  }
  return { numbers, objects, calls: testCallsOf(file) };
}

/** A property's written name (`key`, `'key'`, `['key']`), or undefined when its key is computed from a value. */
function keyOf(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

/**
 * The values `key` takes in an options object: written (`key: …`, `'key': …`, `['key']: …`), shorthand (`{ key }`,
 * read as the file-level constant of that name) or spread from a file-level object literal. A spread of anything
 * else, or a key computed from a value (`[KEY]: …`), cannot be read, so it stands for its own value (and is
 * reported as unreadable).
 */
function valuesOf(
  object: ts.ObjectLiteralExpression,
  key: string,
  constants: Constants,
  depth = 0,
): ts.Expression[] {
  return object.properties.flatMap((property): ts.Expression[] => {
    if (ts.isPropertyAssignment(property)) {
      const name = keyOf(property.name);
      if (name === undefined && ts.isComputedPropertyName(property.name)) return [property.name.expression];
      return name === key ? [property.initializer] : [];
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) return [property.name];
    if (!ts.isSpreadAssignment(property)) return [];
    const spread = ts.isIdentifier(property.expression)
      ? constants.objects.get(property.expression.text)
      : undefined;
    return spread === undefined || depth > constants.objects.size
      ? [property.expression]
      : valuesOf(spread, key, constants, depth + 1);
  });
}

/** An argument as an options object: written in place, or a file-level object constant. */
function optionsOf(arg: ts.Expression, constants: Constants): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(arg)) return arg;
  return ts.isIdentifier(arg) ? constants.objects.get(arg.text) : undefined;
}

/**
 * The timeout arguments of a test call: a value after the callback, `timeout` in an options object, or an options
 * argument (`it(name, OPTIONS, fn)`) that names no readable constant object.
 */
function timeoutArguments(call: ts.CallExpression, constants: Constants): ts.Expression[] {
  const args = [...call.arguments];
  const options = args.flatMap((arg) => {
    const object = optionsOf(arg, constants);
    return object === undefined ? [] : valuesOf(object, 'timeout', constants);
  });
  const middle = args.length >= 3 ? args[1] : undefined;
  const unreadable =
    middle !== undefined && ts.isIdentifier(middle) && optionsOf(middle, constants) === undefined
      ? [middle]
      : [];
  const last = args.at(-1);
  const positional =
    args.length >= 3 &&
    last !== undefined &&
    !ts.isFunctionLike(last) &&
    optionsOf(last, constants) === undefined
      ? [last]
      : [];
  return [...positional, ...options, ...unreadable];
}

/** `vi.setConfig(…)` / `vitest.setConfig(…)`: the suite-wide bound, changed from inside a test file. */
function isSetConfig(call: ts.CallExpression): boolean {
  const target = call.expression;
  return (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === 'setConfig' &&
    ts.isIdentifier(target.expression) &&
    ['vi', 'vitest'].includes(target.expression.text)
  );
}

/**
 * The `testTimeout` values a file sets: every `testTimeout` property written anywhere, and in `setConfig` calls
 * also a spread or an argument that cannot be read.
 */
function testTimeoutArguments(node: ts.Node, constants: Constants): ts.Expression[] {
  if (ts.isPropertyAssignment(node) && keyOf(node.name) === 'testTimeout') return [node.initializer];
  if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'testTimeout') return [node.name];
  if (!ts.isCallExpression(node) || !isSetConfig(node)) return [];
  return node.arguments.flatMap((arg) => {
    const object = optionsOf(arg, constants);
    if (object === undefined) return [arg];
    // A written `testTimeout` is found where it is written; a computed key (`['test' + 'Timeout']`) is not (FR3-7).
    return valuesOf(object, 'testTimeout', constants).filter((value) => !written(value, object));
  });
}

/** Whether `value` is a `testTimeout` property written in `object` itself (already found where it is written). */
function written(value: ts.Expression, object: ts.ObjectLiteralExpression): boolean {
  const property = value.parent;
  const named = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property);
  return named && property.parent === object;
}

/** Every timeout a test call in `source` sets, and every suite-wide bound it sets. */
export function timeoutsIn(fileName: string, source: string): Timeout[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const constants = constantsOf(file);
  const found: Timeout[] = [];
  const record = (arg: ts.Expression): void => {
    const line = file.getLineAndCharacterOfPosition(arg.getStart(file)).line + 1;
    const ms = ts.isIdentifier(arg) ? constants.numbers.get(arg.text) : numberOf(arg);
    found.push({ where: `${fileName}:${String(line)}`, text: arg.getText(file), ms });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && constants.calls.has(callee(node.expression) ?? '')) {
      for (const arg of timeoutArguments(node, constants)) record(arg);
    }
    for (const arg of testTimeoutArguments(node, constants)) record(arg);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return /\.spec\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The timeouts that restate or shorten the suite-wide one, or that cannot be read. */
export const offending = (timeouts: readonly Timeout[]): string[] =>
  timeouts
    .filter(({ ms }) => ms === undefined || ms <= TEST_TIMEOUT_MS)
    .map(({ where, text }) => `${where} ${text}`);
