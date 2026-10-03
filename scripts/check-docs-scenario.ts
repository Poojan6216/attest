/**
 * The golden file format check of scripts/check-docs.ts (QA-R14, QA-G15, TECH-C10, TECH-R5).
 *
 * docs/grading.md §15 is the whole format of a golden scenario file: a scenario is "written from this document
 * alone". So every key the strict schema in extension/tests/golden/scenario-schema.ts accepts must appear in a §15
 * code block as a JSON key (`"assertIds":`), and every string a `z.literal` key holds (the event kinds) as a JSON
 * string (`"regrade"`). A key the schema gains without a §15 example then fails `pnpm check-docs` (Hard Rule 12:
 * the contract never describes a format the files do not have).
 *
 * The schema is read as TypeScript source and never run: the keys of every object literal passed to
 * `z.strictObject`, `z.object` or `z.looseObject`, and the string argument of a `z.literal(…)` such a key holds
 * (also under `.optional()` and the like). A spread (`...shape`) names no key it can see, so the schema has none.
 */
import ts from 'typescript';

import { splitBlocks } from './check-docs-blocks';

const GRADING_DOC = 'docs/grading.md';
export const SCENARIO_SCHEMA = 'extension/tests/golden/scenario-schema.ts';

const OBJECT_FACTORIES: ReadonlySet<string> = new Set(['strictObject', 'object', 'looseObject']);
const SECTION_15 = /^ {0,3}## 15\.[ \t]/;
const LEVEL_2 = /^ {0,3}##[ \t]/;
/** A JSON string in a code line, and whether a `:` follows it (a key). */
const JSON_STRING = /"((?:[^"\\]|\\.)*)"([ \t]*:)?/g;

/** What a scenario file may say: object keys, and the strings a literal-valued key may hold. */
export interface SchemaVocabulary {
  readonly keys: ReadonlySet<string>;
  readonly literals: ReadonlySet<string>;
}

/** One problem, as check-docs reports it (1-based line, 0 for the file as a whole). */
export interface ScenarioProblem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** In code-unit order, never locale order. */
function sorted(set: ReadonlySet<string>): string[] {
  return [...set].sort((a, b) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
}

function calleeName(call: ts.CallExpression): string | null {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
    ? name.text
    : null;
}

/** The string of `z.literal('x')`, looking through chained calls such as `.optional()`; else null. */
function literalOf(node: ts.Expression): string | null {
  let current: ts.Expression = node;
  while (ts.isCallExpression(current)) {
    const [first] = current.arguments;
    if (calleeName(current) === 'literal')
      return first !== undefined && ts.isStringLiteral(first) ? first.text : null;
    if (!ts.isPropertyAccessExpression(current.expression)) return null;
    current = current.expression.expression;
  }
  return null;
}

function collectObject(literal: ts.ObjectLiteralExpression, keys: Set<string>, literals: Set<string>): void {
  for (const property of literal.properties) {
    if (ts.isShorthandPropertyAssignment(property)) keys.add(property.name.text);
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (key !== null) keys.add(key);
    const value = literalOf(property.initializer);
    if (value !== null) literals.add(value);
  }
}

/** The keys and literal values of every object schema in `source` (TypeScript text). */
export function schemaVocabulary(source: string): SchemaVocabulary {
  const file = ts.createSourceFile(
    'scenario-schema.ts',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const keys = new Set<string>();
  const literals = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && OBJECT_FACTORIES.has(calleeName(node) ?? '')) {
      const [shape] = node.arguments;
      if (shape !== undefined && ts.isObjectLiteralExpression(shape)) collectObject(shape, keys, literals);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { keys, literals };
}

/** The 1-based line of the §15 heading and the JSON keys and strings written in §15's code blocks; null without §15. */
export function section15Vocabulary(
  grading: string,
): { line: number; keys: Set<string>; strings: Set<string> } | null {
  const lines = grading.split(/\r?\n/);
  const start = lines.findIndex((text) => SECTION_15.test(text));
  if (start === -1) return null;
  const after = lines.findIndex((text, index) => index > start && LEVEL_2.test(text));
  const end = after === -1 ? lines.length : after;
  const keys = new Set<string>();
  const strings = new Set<string>();
  for (const code of splitBlocks(grading).code) {
    if (code.n <= start + 1 || code.n > end) continue;
    for (const match of code.text.matchAll(JSON_STRING)) {
      const text = match[1] ?? '';
      strings.add(text);
      if (match[2] !== undefined) keys.add(text);
    }
  }
  return { line: start + 1, keys, strings };
}

/**
 * The problems with §15 as the golden file format, and how many schema keys and literals were checked. Each text is
 * null when its file is missing. Nothing is checked when neither the schema nor §15 exists (a repository without a
 * golden suite); when one exists without the other, that is the problem.
 */
export function scenarioKeyProblems(
  schema: string | null,
  grading: string | null,
): { problems: ScenarioProblem[]; checked: number } {
  const section = grading === null ? null : section15Vocabulary(grading);
  if (schema === null) {
    const problems =
      section === null
        ? []
        : [{ file: SCENARIO_SCHEMA, line: 0, message: `missing: ${GRADING_DOC} §15 documents its keys` }];
    return { problems, checked: 0 };
  }
  if (grading === null) return { problems: [], checked: 0 }; // check-docs already reports the missing doc
  const vocabulary = schemaVocabulary(schema);
  if (section === null) {
    const message = `no "## 15." section: every key of ${SCENARIO_SCHEMA} must be documented there`;
    return { problems: [{ file: GRADING_DOC, line: 0, message }], checked: 0 };
  }
  const problems: ScenarioProblem[] = [];
  if (vocabulary.keys.size === 0) {
    problems.push({ file: SCENARIO_SCHEMA, line: 0, message: 'no z.strictObject or z.object keys found' });
  }
  for (const key of sorted(vocabulary.keys)) {
    if (section.keys.has(key)) continue;
    const message = `scenario key '${key}' from ${SCENARIO_SCHEMA} is not in a §15 example (write "${key}": there)`;
    problems.push({ file: GRADING_DOC, line: section.line, message });
  }
  for (const value of sorted(vocabulary.literals)) {
    if (section.strings.has(value)) continue;
    const message = `scenario value '${value}' from ${SCENARIO_SCHEMA} is not in a §15 example (write "${value}" there)`;
    problems.push({ file: GRADING_DOC, line: section.line, message });
  }
  return { problems, checked: vocabulary.keys.size + vocabulary.literals.size };
}
