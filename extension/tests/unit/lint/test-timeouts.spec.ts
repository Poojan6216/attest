/**
 * One suite-wide test timeout (vitest.config.ts TEST_TIMEOUT_MS, 60 s; TECH-R3). No unit, property or golden test
 * restates or shortens it: a timeout at or under 60 s is noise at best, and at worst a load-dependent failure with
 * no defect (qa_tester rule 10). A test that needs longer says so itself, with a literal or a file constant above
 * 60 s (the 120 s, 300 s and 600 s properties). Hooks keep their own timeouts: Vitest's hookTimeout is separate.
 * The scan reads a timeout however it is written (PI-8): positional, `{ timeout: … }`, shorthand `{ timeout }`, a
 * spread of a file-level options object, and the suite-wide bound itself, `vi.setConfig({ testTimeout })` or any
 * `testTimeout` property. A value it cannot read (an imported constant, a spread of anything but a file-level object
 * literal) counts as offending.
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

/** The timeout arguments of a test call: a value after the callback, or `timeout` in an options object. */
function timeoutArguments(call: ts.CallExpression, constants: Constants): ts.Expression[] {
  const args = [...call.arguments];
  const options = args.flatMap((arg) => {
    const object = optionsOf(arg, constants);
    return object === undefined ? [] : valuesOf(object, 'timeout', constants);
  });
  const last = args.at(-1);
  const positional =
    args.length >= 3 &&
    last !== undefined &&
    !ts.isFunctionLike(last) &&
    optionsOf(last, constants) === undefined
      ? [last]
      : [];
  return [...positional, ...options];
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
    if (ts.isObjectLiteralExpression(arg))
      return valuesOf(arg, 'testTimeout', constants).filter((value) => !written(value, arg));
    const object = optionsOf(arg, constants);
    return object === undefined ? [arg] : [];
  });
}

/** Whether `value` is a `testTimeout` property written in `object` itself (already found where it is written). */
function written(value: ts.Expression, object: ts.ObjectLiteralExpression): boolean {
  const property = value.parent;
  const named = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property);
  return named && property.parent === object;
}

/** Every timeout a test call in `source` sets, and every suite-wide bound it sets. */
function timeoutsIn(fileName: string, source: string): Timeout[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const constants = constantsOf(file);
  const found: Timeout[] = [];
  const record = (arg: ts.Expression): void => {
    const line = file.getLineAndCharacterOfPosition(arg.getStart(file)).line + 1;
    const ms = ts.isIdentifier(arg) ? constants.numbers.get(arg.text) : numberOf(arg);
    found.push({ where: `${fileName}:${String(line)}`, text: arg.getText(file), ms });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && TEST_CALLS.has(callee(node.expression) ?? '')) {
      for (const arg of timeoutArguments(node, constants)) record(arg);
    }
    for (const arg of testTimeoutArguments(node, constants)) record(arg);
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
});

describe('test timeouts: the scanner reads every spelling (negative controls)', () => {
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

/** Every other way to write a timeout (PI-8): shorthand, spreads, quoted and computed keys, the suite-wide bound. */
const SPELLINGS = [
  'const timeout = 1_000;',
  'const OPTS = { timeout: 2_000 };',
  'const LONG = { timeout: 600_000 };',
  "const GATE = { tags: ['gate'] };",
  "it('shorthand', { timeout }, () => {});",
  "it('spread', { ...OPTS }, () => {});",
  "it('spread imported', { ...IMPORTED }, () => {});",
  'vi.setConfig({ testTimeout: 1_000 });',
  'vitest.setConfig(CONFIG);',
  'vi.setConfig({ ...SHARED });',
  'const testTimeout = 5_000;',
  'vi.setConfig({ testTimeout });',
  "it('long', { ...LONG }, () => {});",
  "describe('gate', { ...GATE }, () => {});",
  'vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_000 });',
  "it('quoted', { 'timeout': 3_000 }, () => {});",
  "it('computed', { ['timeout']: 4_000 }, () => {});",
  "it('computed key', { [KEY]: 600_000 }, () => {});",
  "vi.setConfig({ ['testTimeout']: 5_000 });",
  "const config = { 'testTimeout': 6_000 };",
].join('\n');

/** What the scanner must report in SPELLINGS: every value at or under 60 s, and every one it cannot read. */
const SPELLINGS_OFFENDING = [
  'probe.spec.ts:5 timeout',
  'probe.spec.ts:2 2_000',
  'probe.spec.ts:7 IMPORTED',
  'probe.spec.ts:8 1_000',
  'probe.spec.ts:9 CONFIG',
  'probe.spec.ts:10 SHARED',
  'probe.spec.ts:12 testTimeout',
  'probe.spec.ts:16 3_000',
  'probe.spec.ts:17 4_000',
  'probe.spec.ts:18 KEY',
  'probe.spec.ts:19 5_000',
  'probe.spec.ts:20 6_000',
];

describe('test timeouts: shorthand, spreads and the suite-wide bound (PI-8)', () => {
  it('the scanner sees shorthand, spread options and the suite-wide bound set from a test file', () => {
    expect(offending(timeoutsIn('probe.spec.ts', SPELLINGS))).toEqual(SPELLINGS_OFFENDING);
  });
});
