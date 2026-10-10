/**
 * Every string a person can read in the shipped UI (sprint_4 4.10, the copy test): found in the source by walking its
 * TypeScript syntax, so a string is checked before any surface renders it.
 *
 * What counts as visible:
 *  - JSX text;
 *  - a string or template inside a JSX expression a component renders as children (`{on ? 'On' : 'Off'}`);
 *  - the value of a JSX attribute or prop a person reads or hears (VISIBLE_ATTRIBUTES: `aria-label`, `title`, `alt`,
 *    `placeholder`, a component's `label`, `title`, `note` and the like);
 *  - in a text module (TEXT_MODULES: the label, text and share modules, `src/core/reason-text.ts`) and in a page's
 *    module-level tables (`STATUS`, `READS`, …), every string and template.
 * Never counted: module names, type-level strings, object keys, the operands of a comparison, a `case` label, a class
 * list (a `class` attribute, a constant whose name says CLASS or STYLE, or a string made only of Tailwind utilities),
 * and the arguments of a call that takes code, not copy (the logger, DOM queries, events, URLs, storage keys).
 * Pure: reads files only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

export const EXTENSION_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Where the UI lives: every page and every shared component. */
const UI_DIRS = ['src/ui', 'entrypoints'];

/** No text a person reads: the content scripts, the service worker's entry, and the development-only components page. */
const NOT_UI = ['entrypoints/content', 'entrypoints/background.ts', 'entrypoints/dev'];

/** Modules made of copy: every string in them is read by a person (a code is filtered by the rules below). */
const TEXT_MODULE = /(?:-labels|-text|-share)\.ts$|\/format\.ts$|\/grant-form\.ts$|\/clipboard\.ts$/u;

/** Text outside the UI folders that the UI shows: the reasons, in Attest's own words. */
const EXTRA_TEXT_FILES = ['src/core/reason-text.ts'];

/** JSX attributes and component props whose value a person reads or hears. */
const VISIBLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'alt',
  'placeholder',
  'label',
  'heading',
  'message',
  'note',
  'description',
  'hint',
  'emptyText',
  'children',
]);

/** Calls whose arguments are code (an event name, a selector, a key, a URL), never copy. */
const CODE_CALLS =
  /^(?:log\.\w+|.*querySelector(?:All)?|.*addEventListener|.*removeEventListener|.*getURL|.*matchMedia|.*createElement|.*getContext|.*toBlob|.*startsWith|.*endsWith|.*includes|.*split|.*replace|.*replaceAll|.*padStart|.*hasOwn|.*get|.*set|.*remove|.*getItem|.*setItem|.*emulateMedia|.*Intl\.\w+|.*toLocaleString|.*toLocaleDateString|.*toLocaleTimeString|.*setAttribute|.*getAttribute|.*closest|.*matches|.*dispatchEvent|.*CustomEvent|.*Event|.*Date|.*parse|.*safeParse|.*literal|.*enum|.*regex|.*sendMessage|.*send|.*sendSetting|.*sendCommand|.*create|.*query|.*open|.*setOptions|.*Blob|.*ClipboardItem|.*write|.*writeText|.*scrollTo|.*focus|.*fetch)$/u;

/** A constant holding class lists or styles. */
const STYLE_CONSTANT = /CLASS|STYLE|^BASE$|FONT|PALETTE/u;

/** One Tailwind utility (with its variants, an arbitrary value, a fraction or an important mark). */
const UTILITY = /^!?(?:[a-z0-9-]+:)*!?-?[a-z][a-z0-9-]*(?:-\[[^\]]+\]|\/[0-9]+|\.[0-9]+)?!?$/u;

/** A code token, never prose: a grade, a state or a currency code (`NOT_FOUND`, `PENDING`, `USD`). */
const CODE_TOKEN = /^[A-Z][A-Z0-9_]*$/u;

/** Whether `text` is a class list: utilities only, at least one of them plainly a utility. */
export function isClassList(text: string): boolean {
  const tokens = text.trim().split(/\s+/u);
  return (
    tokens.length > 0 &&
    tokens.every((token) => UTILITY.test(token)) &&
    tokens.some((token) => token.includes('-') || token.includes(':'))
  );
}

export interface VisibleString {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function sourceFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const relative = path.relative(EXTENSION_ROOT, full);
    if (NOT_UI.some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`))) continue;
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/u.test(name) && !name.endsWith('.d.ts')) out.push(relative);
  }
}

/** Every UI source file, relative to the extension, in a stable order. */
export function uiSourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of UI_DIRS) sourceFiles(path.join(EXTENSION_ROOT, dir), out);
  return [...out, ...EXTRA_TEXT_FILES].sort();
}

/** `node`'s ancestors, nearest first, up to and with its source file. */
function ancestors(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  for (let at = node; !ts.isSourceFile(at);) {
    at = at.parent;
    out.push(at);
  }
  return out;
}

/** The name of the JSX attribute `node` is (part of) the value of, or undefined. */
function attributeOf(node: ts.Node): string | undefined {
  for (const at of ancestors(node)) {
    if (ts.isJsxAttribute(at)) return at.name.getText();
    if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at) || ts.isJsxFragment(at)) return undefined;
  }
  return undefined;
}

/** Whether `node` sits in JSX children (`<p>{…}</p>`), not in an attribute. */
function inJsxChildren(node: ts.Node): boolean {
  for (const at of ancestors(node)) {
    if (ts.isJsxAttribute(at)) return false;
    if (ts.isJsxExpression(at) && !ts.isJsxAttribute(at.parent)) return true;
  }
  return false;
}

/** The module-level constant `node` belongs to, if any. */
function constantOf(node: ts.Node): string | undefined {
  let name: string | undefined;
  for (const at of ancestors(node)) {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) name = at.name.text;
    if (ts.isFunctionLike(at)) name = undefined;
  }
  return name;
}

/** Whether `node` is code: a type, a key, a comparison operand, a `case`, a module name, a code call's argument. */
function isCode(node: ts.Node): boolean {
  const parent = node.parent;
  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent)
  )
    return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.InKeyword
    ) {
      return true;
    }
  }
  for (const at of ancestors(node)) {
    if (ts.isTypeNode(at)) return true;
    if (ts.isCallExpression(at) || ts.isNewExpression(at)) {
      const callee = at.expression.getText().replace(/\s+/gu, '');
      if (CODE_CALLS.test(callee)) return true;
      break;
    }
    if (ts.isJsxAttribute(at) || ts.isStatement(at)) break;
  }
  return false;
}

/** The text of a string, template or JSX text node, its substitutions written `{…}`. */
function textOf(node: ts.Node): string {
  if (ts.isJsxText(node)) return node.text.replace(/\s+/gu, ' ').trim();
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => `{…}${span.literal.text}`)].join('');
  }
  return '';
}

/** Whether a string found in `file` at `node` is one a person reads (header). */
function visible(file: string, node: ts.Node): boolean {
  if (isCode(node)) return false;
  const attribute = attributeOf(node);
  if (attribute !== undefined) return VISIBLE_ATTRIBUTES.has(attribute);
  if (ts.isJsxText(node) || inJsxChildren(node)) return true;
  const constant = constantOf(node);
  if (constant !== undefined && STYLE_CONSTANT.test(constant)) return false;
  if (TEXT_MODULE.test(file) || EXTRA_TEXT_FILES.includes(file)) return true;
  return constant !== undefined && /^[A-Z][A-Z0-9_]*$/u.test(constant);
}

/** Every visible string of one source text (header); `file` is its path relative to the extension. */
export function visibleStringsOf(file: string, source: string): VisibleString[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: VisibleString[] = [];
  const visit = (node: ts.Node): void => {
    const isText =
      ts.isJsxText(node) ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node);
    if (isText) {
      const text = textOf(node);
      if (text.trim() !== '' && !CODE_TOKEN.test(text) && !isClassList(text) && visible(file, node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        found.push({ file, line: line + 1, text });
      }
      if (!ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Every visible string of the shipped UI (header). */
export function visibleStrings(): VisibleString[] {
  return uiSourceFiles().flatMap((file) =>
    visibleStringsOf(file, readFileSync(path.join(EXTENSION_ROOT, file), 'utf8')),
  );
}

export interface ButtonLabel {
  readonly file: string;
  readonly line: number;
  /** One label the button can show, `{…}` for a value: one per branch of a conditional child. */
  readonly text: string;
}

/** The labels an expression child can give: each branch of a conditional, a string as written, else a value. */
function alternatives(expression: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(expression)) return alternatives(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return [...alternatives(expression.whenTrue), ...alternatives(expression.whenFalse)];
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return [expression.text];
  if (ts.isTemplateExpression(expression)) return [textOf(expression)];
  return ['{…}'];
}

/** Every label `element` can show, its children read in order. */
function labelsOf(element: ts.JsxElement): string[] {
  let labels = [''];
  for (const child of element.children) {
    if (ts.isJsxText(child)) {
      labels = labels.map((label) => `${label}${child.text}`);
    } else if (ts.isJsxExpression(child) && child.expression !== undefined) {
      const options = alternatives(child.expression);
      labels = labels.flatMap((label) => options.map((option) => `${label}${option}`));
    } else if (ts.isJsxElement(child)) {
      const inner = labelsOf(child);
      labels = labels.flatMap((label) => inner.map((option) => `${label} ${option}`));
    }
  }
  return labels.map((label) => label.replace(/\s+/gu, ' ').trim()).filter((label) => label !== '');
}

/** Every label every button of one source text can show (`<Button>` and `<button>`). */
export function buttonLabelsOf(file: string, source: string): ButtonLabel[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: ButtonLabel[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && ['Button', 'button'].includes(node.openingElement.tagName.getText())) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      for (const text of labelsOf(node)) found.push({ file, line: line + 1, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Every button label of the shipped UI (header). */
export function buttonLabels(): ButtonLabel[] {
  return uiSourceFiles().flatMap((file) =>
    buttonLabelsOf(file, readFileSync(path.join(EXTENSION_ROOT, file), 'utf8')),
  );
}
