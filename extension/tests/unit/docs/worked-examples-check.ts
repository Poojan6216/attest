/**
 * Checks the §16 worked examples of docs/grading.md against the golden files they cite (task 1.11). The doc may
 * restate a golden file but never disagree with it: every summary row's grade, rule, state and score must be the
 * file's expectation, every mandatory scenario (agents/ledger_engineer.md) and the §2 demo must be worked, and
 * every row of §16.15 must name golden files that really end on that rule. Each function returns problems as
 * strings, so a test can prove it rejects a broken copy of the doc.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { githubSlug, headingText } from '../../../../scripts/check-docs-markdown';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
export const GOLDEN_DIR = path.join(REPO_ROOT, 'extension', 'tests', 'golden');
const GOLDEN_LINK_PREFIX = '../extension/tests/golden/';
const SUMMARY_HEADER = '| Example | Golden file | Receipt | Grade | Rule | State | Score |';
const RULE_HEADER = '| Rule | Then | Worked examples | Other golden files |';
/** The terminal rule (§6): not in `policy.rules`, listed last in §16.15. */
const TERMINAL_RULE = { id: 'default_unverifiable', then: 'UNVERIFIABLE' };
/** Tags of the demo scenarios, beside the `ledger_engineer:` tags of the mandatory ones. */
const DEMO_TAGS = ['contract:demo', 'contract:demo_unverifiable'];
/** The mandatory golden scenarios listed in agents/ledger_engineer.md. */
export const MANDATORY_COUNT = 12;

const GoldenFile = z.object({
  covers: z.array(z.string()),
  expect: z.array(
    z.object({
      ref: z.string().optional(),
      grade: z.string(),
      ruleId: z.string(),
      state: z.string(),
      score: z.string().nullable().optional(),
    }),
  ),
});
export type GoldenFile = z.infer<typeof GoldenFile>;

const PolicyRules = z.object({ rules: z.array(z.object({ id: z.string(), then: z.string() })) });
export type PolicyRule = z.infer<typeof PolicyRules>['rules'][number];

export interface SummaryRow {
  readonly example: string;
  readonly anchor: string;
  readonly fileText: string;
  readonly fileTarget: string;
  readonly ref: string;
  readonly grade: string;
  readonly rule: string;
  readonly state: string;
  readonly score: string;
}

export interface RuleRow {
  readonly rule: string;
  readonly then: string;
  readonly examples: readonly string[];
  readonly files: readonly string[];
}

interface Link {
  readonly text: string;
  readonly target: string;
}

/** Every golden file by name. */
export function loadGoldenFiles(): Map<string, GoldenFile> {
  const files = new Map<string, GoldenFile>();
  for (const name of readdirSync(GOLDEN_DIR)
    .filter((file) => /^\d{2,3}-.*\.json$/.test(file))
    .sort()) {
    files.set(name, GoldenFile.parse(JSON.parse(readFileSync(path.join(GOLDEN_DIR, name), 'utf8'))));
  }
  return files;
}

export function loadPolicyRules(): PolicyRule[] {
  const json: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'default.json'), 'utf8'));
  return PolicyRules.parse(json).rules;
}

/** The body rows of the table whose header line is `header`, as trimmed cells. */
function tableRows(doc: string, header: string): string[][] {
  const lines = doc.split('\n');
  const start = lines.indexOf(header);
  if (start === -1) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

function linksIn(cell: string): Link[] {
  return [...cell.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)].map((m) => ({
    text: m[1] ?? '',
    target: m[2] ?? '',
  }));
}

const unquote = (cell: string): string => cell.replace(/^`|`$/g, '');

export function summaryRows(doc: string): SummaryRow[] {
  return tableRows(doc, SUMMARY_HEADER).map(
    ([example = '', file = '', ref = '', grade = '', rule = '', state = '', score = '']) => {
      const exampleLink = linksIn(example)[0];
      const fileLink = linksIn(file)[0];
      return {
        example: exampleLink?.text ?? example,
        anchor: exampleLink?.target.replace(/^#/, '') ?? '',
        fileText: fileLink?.text ?? file,
        fileTarget: fileLink?.target ?? '',
        ref,
        grade,
        rule: unquote(rule),
        state,
        score,
      };
    },
  );
}

export function ruleRows(doc: string): RuleRow[] {
  return tableRows(doc, RULE_HEADER).map(([rule = '', then = '', examples = '', files = '']) => ({
    rule: unquote(rule),
    then,
    examples: linksIn(examples).map((link) => link.text),
    files: linksIn(files).map((link) => link.target),
  }));
}

/** The golden file a doc link names, or a problem. */
function goldenOf(target: string, golden: ReadonlyMap<string, GoldenFile>): GoldenFile | string {
  const name = target.slice(GOLDEN_LINK_PREFIX.length);
  if (!target.startsWith(GOLDEN_LINK_PREFIX) || name.includes('/'))
    return `'${target}' is not a golden file link`;
  return golden.get(name) ?? `'${target}' names no golden file`;
}

/** Each summary row agrees with the golden expectation it cites. */
export function summaryProblems(
  rows: readonly SummaryRow[],
  golden: ReadonlyMap<string, GoldenFile>,
): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    const where = `${row.example} ${row.ref}`;
    const file = goldenOf(row.fileTarget, golden);
    if (typeof file === 'string') {
      problems.push(`${where}: ${file}`);
      continue;
    }
    if (path.posix.basename(row.fileTarget) !== row.fileText)
      problems.push(`${where}: link text is not the file name`);
    const expected = file.expect.find((entry) => entry.ref === row.ref);
    if (expected === undefined) {
      problems.push(`${where}: ${row.fileText} expects no receipt ${row.ref}`);
      continue;
    }
    const score = expected.score ?? 'none';
    const pairs: [string, string, string][] = [
      ['grade', row.grade, expected.grade],
      ['rule', row.rule, expected.ruleId],
      ['state', row.state, expected.state],
      ['score', row.score, score],
    ];
    for (const [field, doc, file] of pairs) {
      if (doc !== file) problems.push(`${where}: ${field} is ${doc} in the doc, ${file} in ${row.fileText}`);
    }
  }
  return problems;
}

/** Every mandatory tag and the two demo tags are covered by a golden file the summary cites. */
export function mandatoryProblems(
  rows: readonly SummaryRow[],
  golden: ReadonlyMap<string, GoldenFile>,
): string[] {
  const cited = new Set(rows.map((row) => row.fileText));
  const tags = new Set<string>();
  const covered = new Set<string>();
  for (const [name, file] of golden) {
    for (const tag of file.covers) {
      if (!tag.startsWith('ledger_engineer:') && !DEMO_TAGS.includes(tag)) continue;
      tags.add(tag);
      if (cited.has(name)) covered.add(tag);
    }
  }
  const problems = [...tags]
    .filter((tag) => !covered.has(tag))
    .map((tag) => `no worked example covers ${tag}`);
  const mandatory = [...tags].filter((tag) => tag.startsWith('ledger_engineer:')).length;
  if (mandatory !== MANDATORY_COUNT)
    problems.push(`${String(mandatory)} mandatory tags, expected ${String(MANDATORY_COUNT)}`);
  for (const tag of DEMO_TAGS) if (!tags.has(tag)) problems.push(`no golden file is tagged ${tag}`);
  return problems;
}

/** What a row's section must state (task 1.11 (b)): the rule that fires, the state, and the score when scored. */
function statedProblems(row: SummaryRow, body: string): string[] {
  const where = `${row.example} ${row.ref}`;
  const missing: string[] = [];
  if (!body.includes(`\`${row.rule}\``)) missing.push(`rule \`${row.rule}\``);
  if (!new RegExp(`\\b${row.state}\\b`).test(body)) missing.push(`state ${row.state}`);
  if (row.score !== 'none' && !body.includes(row.score)) missing.push(`score ${row.score}`);
  return missing.map((what) => `${where}: section does not state its ${what}`);
}

/**
 * Each example has a `### <id> …` section that its anchor names, that links its golden file(s), and that states
 * the rule, state and score of every summary row that cites it.
 */
export function sectionProblems(doc: string, rows: readonly SummaryRow[]): string[] {
  const problems: string[] = [];
  const sections = new Map<string, { slug: string; body: string }>();
  for (const part of doc.split(/^### /m).slice(1)) {
    const [heading = '', ...body] = part.split('\n');
    const id = heading.split(' ')[0] ?? '';
    sections.set(id, { slug: githubSlug(headingText(heading)), body: body.join('\n') });
  }
  for (const row of rows) {
    const section = sections.get(row.example);
    if (section === undefined) problems.push(`${row.example}: no "### ${row.example}" section`);
    else if (section.slug !== row.anchor)
      problems.push(`${row.example}: anchor #${row.anchor} is not its heading`);
    else if (!section.body.includes(`](${row.fileTarget})`))
      problems.push(`${row.example}: section does not link ${row.fileText}`);
    else problems.push(...statedProblems(row, section.body));
  }
  return problems;
}

/** §16.15 lists every rule in policy order (then the terminal rule), each with files that end on it. */
export function ruleTableProblems(
  rules: readonly RuleRow[],
  rows: readonly SummaryRow[],
  policy: readonly PolicyRule[],
  golden: ReadonlyMap<string, GoldenFile>,
): string[] {
  const problems: string[] = [];
  const expected = [...policy, TERMINAL_RULE];
  const ids = rules.map((row) => row.rule).join(', ');
  if (ids !== expected.map((rule) => rule.id).join(', '))
    problems.push(`rule rows are [${ids}], not the policy order`);
  for (const row of rules) {
    const then = expected.find((rule) => rule.id === row.rule)?.then;
    if (then !== row.then) problems.push(`${row.rule}: then is ${row.then}, policy says ${String(then)}`);
    for (const example of row.examples) {
      if (!rows.some((summary) => summary.example === example && summary.rule === row.rule)) {
        problems.push(`${row.rule}: example ${example} has no summary row with this rule`);
      }
    }
    if (row.files.length === 0) problems.push(`${row.rule}: no golden file listed`);
    for (const target of row.files) {
      const file = goldenOf(target, golden);
      if (typeof file === 'string') problems.push(`${row.rule}: ${file}`);
      else if (!file.expect.some((entry) => entry.ruleId === row.rule))
        problems.push(`${row.rule}: ${target} never ends on it`);
    }
  }
  return problems;
}
