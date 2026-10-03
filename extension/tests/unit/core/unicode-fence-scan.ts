/**
 * The scan behind the unicode fence (unicode-fence.spec.ts; SEC-1, Hard Rule 4): what in a TypeScript source would
 * let the engine's Unicode tables decide how src/core reads text. It walks the syntax tree the TypeScript parser
 * builds, so a comment never hides or fakes a finding and a `//` inside a string is only a string. Text the file
 * spells statically (a string, a template, a `+` of them, a `const` holding one, a Unicode 15.0 class) is read as
 * the engine would read it; a regular expression built from anything else is refused.
 */
import path from 'node:path';

import ts from 'typescript';

import { TABLE_FILES } from '../../../../scripts/gen-unicode-baseline';
import { BASELINE_CLASS } from '../../../src/core/unicode-baseline';

export type Rule =
  | 'property'
  | 'space-class'
  | 'unicode-ignore-case'
  | 'regexp-built'
  | 'other-case'
  | 'trim'
  | 'normalize'
  | 'lowercase';

export interface Finding {
  /** The file, as a `/`-separated path relative to src/core. */
  readonly file: string;
  readonly line: number;
  readonly rule: Rule;
  readonly text: string;
  /** The function declaration the finding is in, else the name its top-level statement declares, else ''. */
  readonly within: string;
}

/** The generated Unicode 15.0 tables (scripts/gen-unicode-baseline.ts): the only src/core files the scan skips. */
export const TABLE_SOURCES: ReadonlySet<string> = new Set(
  Object.values(TABLE_FILES).map((file) => path.basename(file)),
);
export const BASELINE_FILE = 'unicode-baseline.ts';
/** The modules, as paths relative to src/core, that a relative import must name for the scan to trust it. */
const TABLE_MODULES: ReadonlySet<string> = new Set(
  [...TABLE_SOURCES].map((file) => path.basename(file, '.ts')),
);
const BASELINE_MODULE = path.basename(BASELINE_FILE, '.ts');

/** `\p{…}` (but ASCII and Cc) or `\s` behind an odd run of backslashes: a class escape, not a literal backslash. */
const PROPERTY = /(?<!\\)(?:\\\\)*\\[pP]\{(?!ASCII\}|Cc\})/;
const SPACE_CLASS = /(?<!\\)(?:\\\\)*\\[sS]/;
const UNICODE_FLAG = /[uv]/;
/** Pattern text an `i` expression without `u` or `v` folds by the engine's case tables: anything not plain ASCII. */
const NOT_PLAIN_ASCII = /\\[ux]|[^\x20-\x7E]/;
/**
 * A backreference (`\1`–`\9…`, `\k<name>`) or, without `u`, a legacy octal escape (`\1`–`\377`): with `i`, the
 * engine compares the text a group captured, which may be any character, by its own case tables.
 */
const BACKREFERENCE = /(?<!\\)(?:\\\\)*\\(?:[1-9]|k<)/;
/** An inline modifier group (`(?i:…)`, `(?-i:…)`, `(?i-m:…)`): it switches `i` on or off whatever the flags say. */
const MODIFIER = /(?<!\\)(?:\\\\)*\(\?[A-Za-z-]+:/;
/** What a Unicode 15.0 class contributes to composed text: non-ASCII characters, and no class escape. */
const CLASS = '\\x80';
const asRule =
  (rule: Rule) =>
  (name: string): [string, Rule] => [name, rule];
/** Members that read the engine's Unicode or locale data, or build a regular expression, and the rule each breaks. */
const METHODS: ReadonlyMap<string, Rule> = new Map<string, Rule>([
  ...['toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'localeCompare'].map(asRule('other-case')),
  ...['trim', 'trimStart', 'trimEnd', 'trimLeft', 'trimRight'].map(asRule('trim')),
  ['normalize', 'normalize'],
  ['toLowerCase', 'lowercase'],
  ...['compile', 'match', 'matchAll', 'search', 'RegExp'].map(asRule('regexp-built')),
]);
/** Methods that build a regular expression from an argument that is not one. */
const MATCHERS: ReadonlySet<string> = new Set(['match', 'matchAll', 'search']);
/** What reading a method value to call it looks like. */
const METHOD_USES: ReadonlySet<string> = new Set(['call', 'apply', 'bind']);
const CLASS_NAMES: ReadonlySet<string> = new Set(Object.keys(BASELINE_CLASS));

/** One file: its tree, its name, and every declaration of each name in it (one declared twice is never resolved). */
interface Source {
  readonly file: ts.SourceFile;
  readonly name: string;
  readonly declarations: ReadonlyMap<string, readonly ts.Node[]>;
}

/**
 * Each identifier that names its parent (a variable, parameter, import, function, class or binding element, but
 * also a property key, which only makes a name harder to resolve), by name.
 */
function declarationsOf(file: ts.SourceFile): Map<string, ts.Node[]> {
  const declarations = new Map<string, ts.Node[]>();
  const visit = (node: ts.Node): void => {
    const { parent } = node;
    const names = ts.isIdentifier(node) && 'name' in parent && parent.name === node;
    if (names && !ts.isPropertyAccessExpression(parent))
      declarations.set(node.text, [...(declarations.get(node.text) ?? []), parent]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return declarations;
}

function declarationOf(source: Source, name: string): ts.Node | undefined {
  const found = source.declarations.get(name);
  return found?.length === 1 ? found[0] : undefined;
}

/** The initializer of a `const` that binds one name, else undefined. */
function constInitializer(node: ts.Node | undefined): ts.Expression | undefined {
  if (node === undefined || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return undefined;
  return (node.parent.flags & ts.NodeFlags.Const) === 0 ? undefined : node.initializer;
}

/**
 * `import { name } from '<module>'` (not renamed), where the relative specifier, read from the importing file's
 * directory, names a src/core module `trusted` accepts: `./unicode-baseline` at the top, `../unicode-baseline` one
 * directory down (`./unicode-baseline` there is another module).
 */
function importedFrom(
  source: Source,
  node: ts.Node | undefined,
  trusted: (module: string) => boolean,
): boolean {
  if (node === undefined || !ts.isImportSpecifier(node) || node.propertyName !== undefined) return false;
  const specifier = node.parent.parent.parent.moduleSpecifier;
  if (!ts.isStringLiteral(specifier) || !/^\.\.?\//.test(specifier.text)) return false;
  return trusted(path.posix.join(path.posix.dirname(source.name), specifier.text));
}

function unwrap(node: ts.Expression): ts.Expression {
  const inner =
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
      ? node.expression
      : undefined;
  return inner === undefined ? node : unwrap(inner);
}

/** `BASELINE_CLASS.<class>`, imported from unicode-baseline.ts (or declared there) and declared nowhere else. */
function isBaselineMember(node: ts.Expression, source: Source): boolean {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return false;
  if (node.expression.text !== 'BASELINE_CLASS' || !CLASS_NAMES.has(node.name.text)) return false;
  const declaration = declarationOf(source, 'BASELINE_CLASS');
  if (source.name === BASELINE_FILE)
    return declaration !== undefined && ts.isVariableDeclaration(declaration);
  return importedFrom(source, declaration, (module) => module === BASELINE_MODULE);
}

const isConcatenation = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;

/**
 * The text `node` spells when the file is read (each 15.0 class as CLASS), or null when only run time knows it. A
 * `+` is read only when `concat` is set: a regular expression's pattern may not be one.
 */
function staticText(
  node: ts.Expression,
  source: Source,
  concat: boolean,
  seen = new Set<string>(),
): string | null {
  const bare = unwrap(node);
  const read = (part: ts.Expression): string | null => staticText(part, source, concat, seen);
  if (ts.isStringLiteral(bare) || ts.isNoSubstitutionTemplateLiteral(bare)) return bare.text;
  if (ts.isTemplateExpression(bare)) {
    let text = bare.head.text;
    for (const span of bare.templateSpans) {
      const part = read(span.expression);
      if (part === null) return null;
      text += `${part}${span.literal.text}`;
    }
    return text;
  }
  if (concat && isConcatenation(bare)) {
    const [left, right] = [read(bare.left), read(bare.right)];
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (isBaselineMember(bare, source)) return CLASS;
  if (!ts.isIdentifier(bare) || seen.has(bare.text)) return null;
  const declaration = declarationOf(source, bare.text);
  if (importedFrom(source, declaration, (module) => TABLE_MODULES.has(module))) return CLASS;
  const initializer = constInitializer(declaration);
  return initializer === undefined
    ? null
    : staticText(initializer, source, concat, new Set([...seen, bare.text]));
}

function patternRules(text: string): Rule[] {
  const rules: Rule[] = [];
  if (PROPERTY.test(text)) rules.push('property');
  if (SPACE_CLASS.test(text)) rules.push('space-class');
  return rules;
}

/**
 * Unicode case folding: a modifier group, whatever the flags; or `i` with `u` or `v`, or `i` on a pattern that is
 * not plain ASCII (or not known) or holds a backreference.
 */
function caseRules(flags: string, pattern: string | null): Rule[] {
  if (pattern !== null && MODIFIER.test(pattern)) return ['unicode-ignore-case'];
  if (!flags.includes('i')) return [];
  const folds =
    UNICODE_FLAG.test(flags) ||
    pattern === null ||
    NOT_PLAIN_ASCII.test(pattern) ||
    BACKREFERENCE.test(pattern);
  return folds ? ['unicode-ignore-case'] : [];
}

function isRegExpConstruction(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  return (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'RegExp'
  );
}

/** `RegExp(pattern, flags)`: a string literal for the flags, and a pattern the file spells without a `+`. */
function constructionRules(node: ts.CallExpression | ts.NewExpression, source: Source): Rule[] {
  const [pattern, flags, ...rest] = node.arguments ?? [];
  if (pattern === undefined || flags === undefined || rest.length > 0 || !ts.isStringLiteral(flags))
    return ['regexp-built'];
  if (ts.isRegularExpressionLiteral(pattern))
    return caseRules(flags.text, pattern.text.slice(1, pattern.text.lastIndexOf('/')));
  const text = staticText(pattern, source, false);
  return text === null
    ? [...caseRules(flags.text, null), 'regexp-built']
    : [...caseRules(flags.text, text), ...patternRules(text)];
}

/** The member a property access, a literal-keyed element access or a destructuring names, if any. */
function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    return ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) ? key.text : undefined;
  }
  if (!ts.isBindingElement(node)) return undefined;
  const key = node.propertyName ?? node.name;
  return ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
}

/** `match`, `matchAll` or `search` called with a regular expression literal or a `const` holding a built one. */
function matcherRules(node: ts.CallExpression, source: Source): Rule[] {
  const name = memberName(node.expression);
  if (name === undefined || !MATCHERS.has(name)) return [];
  const [argument] = node.arguments;
  if (argument !== undefined && ts.isRegularExpressionLiteral(argument)) return [];
  const initializer =
    argument !== undefined && ts.isIdentifier(argument)
      ? constInitializer(declarationOf(source, argument.text))
      : undefined;
  const regExp =
    initializer !== undefined &&
    (ts.isRegularExpressionLiteral(initializer) || isRegExpConstruction(initializer));
  return regExp ? [] : ['regexp-built'];
}

/** `RegExp` other than as the callee of a construction, a type, or the right side of `instanceof`; `Intl`. */
function identifierRules(node: ts.Identifier): Rule[] {
  if (node.text === 'Intl') return ['other-case'];
  if (node.text !== 'RegExp') return [];
  const { parent } = node;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) return [];
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return [];
  const instanceOf =
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    parent.right === node;
  return instanceOf ? [] : ['regexp-built'];
}

/**
 * Whether a member is read only as an object, another property of it read (`policy.normalize.stopWords`, or
 * destructured from it): data, not the method. Reading `call`, `apply` or `bind` from it uses the method.
 */
function usedAsObject(node: ts.Node): boolean {
  const { parent } = node;
  const read =
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
      ? [memberName(parent)]
      : ts.isVariableDeclaration(parent) &&
          parent.initializer === node &&
          ts.isObjectBindingPattern(parent.name)
        ? parent.name.elements.map(memberName)
        : [];
  return read.length > 0 && read.every((name) => name !== undefined && !METHOD_USES.has(name));
}

/** Whether `node`, a member, is read to call it later: `.call`, `.apply` or `.bind` read from it. */
function readToCall(node: ts.Node): boolean {
  const { parent } = node;
  const access =
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node;
  return access && METHOD_USES.has(memberName(parent) ?? '');
}

/**
 * A method member read: refused unless it is data. A matcher called directly is judged by its argument at the
 * call; one read to call later (`.call`, `.apply`, `.bind`, or destructured) is refused. A matcher name read any
 * other way may be data (a receipt's `match` reasons): ESLint's type-aware unbound-method refuses every other read
 * of a method's value in src/core (`const m = s.match`, `[s.match]`, `Reflect.apply(String.prototype.match, …)`).
 */
function memberRules(node: ts.Node, name: string, rule: Rule): Rule[] {
  if (usedAsObject(node)) return [];
  if (!MATCHERS.has(name)) return [rule];
  return readToCall(node) || ts.isBindingElement(node) ? [rule] : [];
}

/** Where a string names a type or a property being declared, not a value code could look a method up with. */
function namesNothing(node: ts.Node): boolean {
  const { parent } = node;
  return (
    ts.isLiteralTypeNode(parent) ||
    ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node)
  );
}

/** Class escapes in a regular expression literal (and its flags), in string or template text as written. */
function writtenRules(node: ts.Node, file: ts.SourceFile): Rule[] {
  if (ts.isRegularExpressionLiteral(node)) {
    const end = node.text.lastIndexOf('/');
    const pattern = node.text.slice(1, end);
    return [...patternRules(pattern), ...caseRules(node.text.slice(end + 1), pattern)];
  }
  if (ts.isStringLiteral(node)) return patternRules(node.getText(file));
  const template =
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node);
  return template ? [...patternRules(node.text), ...patternRules(node.rawText ?? '')] : [];
}

/** Text the file spells: a class escape in it as read, or the name of a method code could look up with it. */
function spelledRules(node: ts.Node, source: Source): Rule[] {
  const spelled =
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node) ||
    isConcatenation(node);
  const text = spelled ? staticText(node, source, true) : null;
  if (text === null) return [];
  const named = namesNothing(node) ? undefined : METHODS.get(text);
  return [...patternRules(text), ...(named === undefined ? [] : [named])];
}

function nodeRules(node: ts.Node, source: Source): Rule[] {
  if (isRegExpConstruction(node)) return constructionRules(node, source);
  if (ts.isCallExpression(node)) return matcherRules(node, source);
  if (ts.isIdentifier(node)) return identifierRules(node);
  const member = memberName(node);
  const rule = member === undefined ? undefined : METHODS.get(member);
  if (member !== undefined && rule !== undefined) return memberRules(node, member, rule);
  return [...writtenRules(node, source.file), ...spelledRules(node, source)];
}

/** The function declaration `node` is in, else the first name its top-level statement declares, else ''. */
function enclosingName(node: ts.Node): string {
  let statement = node;
  for (let at = node; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isFunctionDeclaration(at) && at.name !== undefined) return at.name.text;
    statement = at;
  }
  const [first] = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [];
  return first !== undefined && ts.isIdentifier(first.name) ? first.name.text : '';
}

/**
 * Every finding in `text`, read as the TypeScript file `fileName` (a `/`-separated path relative to src/core, which
 * relative imports are resolved from), once per rule and node.
 */
export function findings(fileName: string, text: string): Finding[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const source: Source = { file, name: fileName, declarations: declarationsOf(file) };
  const lines = text.split('\n');
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const at = ts.isPropertyAccessExpression(node) ? node.name : node;
    const { line } = file.getLineAndCharacterOfPosition(at.getStart(file));
    const lineText = (lines[line] ?? '').trim();
    for (const rule of new Set(nodeRules(node, source)))
      found.push({ file: fileName, line: line + 1, rule, text: lineText, within: enclosingName(node) });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
