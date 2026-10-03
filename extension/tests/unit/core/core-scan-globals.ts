/**
 * The globals the grep test (./core-scan.ts) holds src/core to, read from the lists eslint.config.js uses
 * (eslint-rules/core-names.js), so the two cannot drift (FS-1, R4-FENCE-1, R4-FENCE-2; Hard Rules 1 and 4). A name
 * that reaches the network is banned as a word anywhere in code, as attest/no-network bans it as a member anywhere
 * (`navigator.sendBeacon`). Every other global is held to an allowlist, as attest/core-globals holds it: each
 * identifier read as a value that no enclosing scope declares or imports (not a member name, a key, a declaration, a
 * label or a type) must be an ES2023 built-in on CORE_ALLOWED_GLOBALS, so a host name no list foresaw (`Image`,
 * `clientInformation`, `open`) fails as surely as `navigator`. The TypeScript parser's syntax tree tells a read of the
 * global from a local, with no lint and no types: src/core names its time windows `window`, and a local `window` is
 * not the global. RegExp is on the allowlist only to build a pattern or test a value (`new RegExp(…)`,
 * `x instanceof RegExp`), as attest/core-determinism allows: any other read reaches its legacy statics.
 */
import ts from 'typescript';

import {
  CORE_ALLOWED_GLOBALS,
  CORE_RESTRICTED_GLOBAL_NAMES,
  NETWORK_GLOBALS,
  NETWORK_PROPERTIES,
} from '../../../eslint-rules/core-names.js';

/** `name` as a regular expression that matches it literally. */
const literal = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** attest/no-network's names, each as a word anywhere in code: a global, a member or a written key (Hard Rule 1). */
export const NETWORK_PATTERNS: readonly (readonly [string, RegExp])[] = [...NETWORK_PROPERTIES].map(
  (name) => [name, new RegExp(`\\b${literal(name)}\\b`, 'g')] as const,
);

/** The globals lint names in src/core: its no-restricted-globals list and attest/no-network's globals. */
export const RESTRICTED_GLOBALS: ReadonlySet<string> = new Set([
  ...CORE_RESTRICTED_GLOBAL_NAMES,
  ...NETWORK_GLOBALS,
]);

/** Whether `node` holds declarations of its own: a module, a block, a function, a loop head, a catch, a class. */
function opensScope(node: ts.Node): boolean {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node))
    return true;
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) return true;
  return ts.isCatchClause(node) || ts.isFunctionLike(node) || ts.isClassLike(node);
}

/** Adds every name a binding introduces: `a`, `{ a, b: c }`, `[d, ...e]`. */
function addBound(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) if (ts.isBindingElement(element)) addBound(element.name, into);
}

/** A declaration whose name is a value binding of the scope that holds it: a function, class, enum or import. */
function declaredName(node: ts.Node): ts.Identifier | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node))
    return node.name;
  if (ts.isImportClause(node)) return node.name;
  if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node))
    return node.name;
  return ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) ? node.name : undefined;
}

/** The names `scope` declares itself; a nested scope's declarations are its own (a nested function's name is not). */
function declaredIn(scope: ts.Node): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) addBound(node.name, names);
    const name = declaredName(node);
    if (name !== undefined) names.add(name.text);
    if (!opensScope(node)) ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return names;
}

/** Whether `id` names a member, a key, a declaration, a label or an import: not a read of a value by its name. */
function namesSomethingElse(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === id;
  if (ts.isQualifiedName(parent)) return parent.right === id;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return parent.label === id;
  if (ts.isExportSpecifier(parent) || ts.isMetaProperty(parent)) return true;
  return 'name' in parent && parent.name === id;
}

/** Whether `id` sits in a type (`typeof x` in a type, `implements X`): no code reads it. A class's `extends` does. */
function inType(id: ts.Identifier): boolean {
  for (let node: ts.Node = id; !ts.isSourceFile(node); node = node.parent) {
    if (!ts.isTypeNode(node)) continue;
    const heritage = node.parent;
    const extendsClass =
      ts.isExpressionWithTypeArguments(node) &&
      ts.isHeritageClause(heritage) &&
      heritage.token === ts.SyntaxKind.ExtendsKeyword &&
      ts.isClassLike(heritage.parent);
    if (!extendsClass) return true;
  }
  return false;
}

/** Each identifier `source` reads as a global: one no enclosing scope declares or imports. */
function freeIdentifiers(source: string): { file: ts.SourceFile; reads: ts.Identifier[] } {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const scopes = new Map<ts.Node, ReadonlySet<string>>();
  const declares = (scope: ts.Node, name: string): boolean => {
    const names = scopes.get(scope) ?? declaredIn(scope);
    scopes.set(scope, names);
    return names.has(name);
  };
  const local = (id: ts.Identifier): boolean => {
    for (let node: ts.Node = id.parent; ; node = node.parent) {
      if (opensScope(node) && declares(node, id.text)) return true;
      if (ts.isSourceFile(node)) return false;
    }
  };
  const reads: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !namesSomethingElse(node) && !inType(node) && !local(node)) reads.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { file, reads };
}

const lineOf = (file: ts.SourceFile, node: ts.Node): number =>
  file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

/** Each identifier `source` reads as a global, as [line (1-based), name], in source order. */
export function freeReads(source: string): (readonly [number, string])[] {
  const { file, reads } = freeIdentifiers(source);
  return reads.map((id) => [lineOf(file, id), id.text] as const);
}

/** What the scan names a read of the global RegExp other than `new RegExp(…)` or `x instanceof RegExp`. */
export const REGEXP_READ = 'RegExp other than new RegExp';

/**
 * Whether a read of the global RegExp builds a pattern (`new RegExp(…)`) or tests a value (`x instanceof RegExp`),
 * as attest/core-determinism allows: any other read reaches its legacy statics (`RegExp.lastMatch`, `RegExp.$1`),
 * which hold the last match any code in the realm made.
 */
function buildsOrTests(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isNewExpression(parent)) return parent.expression === id;
  const instanceOf =
    ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword;
  return instanceOf && parent.right === id;
}

/**
 * Each global `source` reads that is not on CORE_ALLOWED_GLOBALS, and each read of RegExp that does not build or test
 * (REGEXP_READ), as [line (1-based), name], in source order.
 */
export function globalReads(source: string): (readonly [number, string])[] {
  const { file, reads } = freeIdentifiers(source);
  return reads.flatMap((id) => {
    if (!CORE_ALLOWED_GLOBALS.has(id.text)) return [[lineOf(file, id), id.text] as const];
    if (id.text === 'RegExp' && !buildsOrTests(id)) return [[lineOf(file, id), REGEXP_READ] as const];
    return [];
  });
}
