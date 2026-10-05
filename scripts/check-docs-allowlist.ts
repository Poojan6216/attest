/**
 * The allowlist check of scripts/check-docs.ts (sprint_2 2.9 Done-when; agents/privacy_reviewer.md "every table,
 * every field, its allowlist source"; Hard Rule 2).
 *
 * policy/default.json `allowlistedFields` names, per observation source, the only fields a row of that source may
 * store. docs/privacy-architecture.md must describe every one of them, so a field the policy gains without a word on
 * what it holds fails `pnpm check-docs`, and a field the policy drops cannot stay documented as stored:
 *  - every source has exactly one section whose heading holds the word "allowlist" (singular, outside code) and
 *    names the source as its only inline code span (`### Allowlist: \`gmail.sent\``), and every such section names
 *    a source the policy has;
 *  - in that section (up to the next heading of the same or a higher level), every allowlisted field is the first
 *    cell of a table row, written as one inline code span, with a description in the next cell;
 *  - every such row names a field the policy allowlists for that source.
 * Code blocks and HTML comments are not read (check-docs-blocks.ts). Nothing is checked when the policy is missing
 * or has no `allowlistedFields` (a fixture repository without observers); check-docs reports a missing policy itself.
 */
import { splitBlocks, type DocLine } from './check-docs-blocks';
import { segments } from './check-docs-markdown';

/** The document checked, relative to the repository root. */
export const PRIVACY_DOC = 'docs/privacy-architecture.md';
const POLICY_FILE = 'policy/default.json';

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const TABLE_ROW = /^ {0,3}\|/;
const ALLOWLIST_WORD = /\ballowlist\b/i;
const LETTER = /\p{L}/u;

/** One problem, as check-docs reports it (1-based line, 0 for the file as a whole). */
export interface AllowlistProblem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** One table row of an allowlist section: the field its first cell names, and whether the next cell describes it. */
interface FieldRow {
  readonly field: string;
  readonly described: boolean;
  readonly line: number;
}

/** One allowlist section of the document. */
export interface AllowlistSection {
  readonly source: string;
  readonly line: number;
  readonly rows: readonly FieldRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `allowlistedFields` of the policy text: source → fields. Null when there is nothing to check (no policy, a policy
 * that does not parse, or one without the key); a problem message when the key is there but is not source → fields.
 */
export function policyAllowlists(
  text: string | null,
): ReadonlyMap<string, readonly string[]> | null | string {
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(json) || json.allowlistedFields === undefined) return null;
  const allowlists = json.allowlistedFields;
  if (!isRecord(allowlists)) return 'cannot read "allowlistedFields" (expected source → list of field names)';
  const map = new Map<string, readonly string[]>();
  for (const [source, fields] of Object.entries(allowlists)) {
    if (!Array.isArray(fields) || !fields.every((field): field is string => typeof field === 'string')) {
      return `cannot read "allowlistedFields.${source}" (expected a list of field names)`;
    }
    map.set(source, fields);
  }
  return map;
}

/** The cells of a table row, outer pipes dropped, split on pipes that are not backslash-escaped. */
function cells(row: string): string[] {
  const inner = row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * The field a row's first cell names (one inline code span and nothing else), or null: a header row, a separator
 * row (`|---|`) and a row about anything else name none.
 */
function rowOf(line: DocLine): FieldRow | null {
  const [first = '', ...rest] = cells(line.text);
  const parts = segments(first);
  const [only] = parts;
  if (parts.length !== 1 || !only?.code) return null;
  return { field: only.text, described: LETTER.test(rest[0] ?? ''), line: line.n };
}

/** The source an allowlist heading names, or null when the heading is not one. */
function headingSource(raw: string): string | null {
  const parts = segments(raw);
  const code = parts.filter((part) => part.code);
  const plain = parts
    .filter((part) => !part.code)
    .map((part) => part.text)
    .join(' ');
  const [only] = code;
  return ALLOWLIST_WORD.test(plain) && code.length === 1 && only !== undefined ? only.text : null;
}

/** Every allowlist section of `doc`, in document order. */
export function allowlistSections(doc: string): AllowlistSection[] {
  const sections: { source: string; line: number; level: number; rows: FieldRow[] }[] = [];
  let open: (typeof sections)[number] | null = null;
  for (const line of splitBlocks(doc).prose) {
    const heading = ATX.exec(line.text);
    if (heading !== null) {
      const level = (heading[1] ?? '').length;
      if (open !== null && level <= open.level) open = null;
      const source = headingSource(heading[2] ?? '');
      if (source !== null) {
        open = { source, line: line.n, level, rows: [] };
        sections.push(open);
      }
      continue;
    }
    if (open === null || !TABLE_ROW.test(line.text)) continue;
    const row = rowOf(line);
    if (row !== null) open.rows.push(row);
  }
  return sections.map(({ source, line, rows }) => ({ source, line, rows }));
}

function sectionProblems(section: AllowlistSection, fields: readonly string[]): AllowlistProblem[] {
  const problems: AllowlistProblem[] = [];
  const report = (line: number, message: string): void => {
    problems.push({ file: PRIVACY_DOC, line, message });
  };
  const named = new Set(section.rows.map((row) => row.field));
  for (const field of fields) {
    if (!named.has(field)) {
      report(
        section.line,
        `allowlisted field '${field}' of ${section.source} (${POLICY_FILE}) has no row here: write | \`${field}\` | what it holds |`,
      );
    }
  }
  for (const row of section.rows) {
    if (!fields.includes(row.field)) {
      report(
        row.line,
        `'${row.field}' is described as allowlisted for ${section.source}, but ${POLICY_FILE} does not list it`,
      );
    } else if (!row.described) {
      report(
        row.line,
        `allowlisted field '${row.field}' of ${section.source} has no description in the next cell`,
      );
    }
  }
  return problems;
}

/**
 * The problems with `doc` (docs/privacy-architecture.md, null when missing) as the description of the policy's
 * allowlists (`policy`, the policy file's text, null when missing), and how many allowlisted fields were checked.
 */
export function allowlistProblems(
  policy: string | null,
  doc: string | null,
): { problems: AllowlistProblem[]; checked: number } {
  const allowlists = policyAllowlists(policy);
  if (allowlists === null) return { problems: [], checked: 0 };
  if (typeof allowlists === 'string') {
    return { problems: [{ file: POLICY_FILE, line: 0, message: allowlists }], checked: 0 };
  }
  const checked = [...allowlists.values()].reduce((sum, fields) => sum + fields.length, 0);
  if (doc === null) {
    const message = `missing: every allowlisted field in ${POLICY_FILE} must be described here`;
    return { problems: [{ file: PRIVACY_DOC, line: 0, message }], checked };
  }
  const problems: AllowlistProblem[] = [];
  const seen = new Set<string>();
  for (const section of allowlistSections(doc)) {
    const fields = allowlists.get(section.source);
    if (fields === undefined) {
      const message = `allowlist section names '${section.source}', which has no allowlist in ${POLICY_FILE}`;
      problems.push({ file: PRIVACY_DOC, line: section.line, message });
    } else if (seen.has(section.source)) {
      const message = `a second allowlist section for ${section.source}: describe each source once`;
      problems.push({ file: PRIVACY_DOC, line: section.line, message });
    } else {
      problems.push(...sectionProblems(section, fields));
    }
    seen.add(section.source);
  }
  for (const source of allowlists.keys()) {
    if (seen.has(source)) continue;
    const message = `no allowlist section for ${source}: write a heading "Allowlist: \`${source}\`" with a row per field`;
    problems.push({ file: PRIVACY_DOC, line: 0, message });
  }
  return { problems, checked };
}
