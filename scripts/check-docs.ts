/**
 * `pnpm exec tsx scripts/check-docs.ts [--root <dir>]` — the docs check (agents/docs_writer.md rule 4).
 *
 * Over docs/*.md, README.md and PRIVACY.md, and, where they exist, CHANGELOG.md, MANUAL.md, telemetry-api/README.md and
 * every Markdown file under launch/ (Sprint 7 close, tech review TECH-18), it verifies that:
 * 1. every relative link resolves to a file or directory inside the repo, spelled with its exact letter case (as
 *    GitHub resolves it, even on a case-insensitive file system), and every `#anchor` (in the same document or
 *    in another Markdown file) names a heading or an HTML id there (GitHub's anchor rules);
 * 2. every `pnpm <script>` quoted in code (inline code span, fenced or indented block) names a script in the
 *    package.json of the package it runs in: the repo root's, unless a `cd` earlier in the same code block (and
 *    not inside a subshell `( … )` that has closed),
 *    `-C`/`--dir`, `--filter`, `-w` or a recursive run says otherwise (pnpm's own commands such as `install` and
 *    `exec` need no script);
 * 3. every rule id in policy/default.json appears in docs/grading.md as an inline code span (`verified`), so
 *    a prose word such as "partial" or a JSON listing alone does not count as documenting a rule;
 * 4. every key of the golden scenario schema (extension/tests/golden/scenario-schema.ts) appears in a code block of
 *    docs/grading.md §15, the file format (check-docs-scenario.ts);
 * 5. no Markdown file in the repository holds an absolute local path such as `/Users/<name>` or a `/private/tmp`
 *    scratch directory (check-docs-paths.ts);
 * 6. no Decisions.md entry from the Sprint 1 close on describes how the work was organised (`fixer`, `brief`,
 *    `ownership`, `this run`, …) instead of the decision (check-docs-decisions.ts);
 * 7. every field policy/default.json allowlists for an observation source (`allowlistedFields`) is described in
 *    docs/privacy-architecture.md, in that source's allowlist section, and nothing else is described as allowlisted
 *    there (check-docs-allowlist.ts).
 * It prints one line per problem (`file:line: message`) and exits 1 when there is any, 0 otherwise.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { allowlistProblems, PRIVACY_DOC } from './check-docs-allowlist';
import { splitBlocks } from './check-docs-blocks';
import { AT_REPO_ROOT, pnpmInvocations, shellAfter, type ShellState } from './check-docs-commands';
import { scanMarkdown, segments, type MarkdownScan } from './check-docs-markdown';
import { scriptsFor, workspacePackages, type Workspace } from './check-docs-packages';
import { checkDecisions, DECISIONS_FILE } from './check-docs-decisions';
import { checkLocalPaths } from './check-docs-paths';
import { SCENARIO_SCHEMA, scenarioKeyProblems } from './check-docs-scenario';

export interface DocProblem {
  /** Path relative to the root, with forward slashes. */
  readonly file: string;
  /** 1-based line, or 0 when the problem is about the file as a whole. */
  readonly line: number;
  readonly message: string;
}

export interface DocCheckResult {
  readonly problems: readonly DocProblem[];
  readonly files: number;
  readonly links: number;
  readonly commands: number;
  readonly ruleIds: number;
  /** Scenario schema keys and literal values checked against docs/grading.md §15 (0 without a golden suite). */
  readonly scenarioKeys: number;
  /** Markdown files read for absolute local paths. */
  readonly markdownFiles: number;
  /** Decisions.md lines checked for wording about how the work was organised (0 without the file). */
  readonly decisionLines: number;
  /** Allowlisted fields of policy/default.json checked against docs/privacy-architecture.md (0 without any). */
  readonly allowlistFields: number;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRADING_DOC = 'docs/grading.md';
const POLICY_FILE = 'policy/default.json';
const ROOT_DOCS = ['README.md', 'PRIVACY.md'];
/** Read too where they exist (header): what a release is made from, and the launch kit. */
const RELEASE_DOCS = ['CHANGELOG.md', 'MANUAL.md', 'telemetry-api/README.md'];
const LAUNCH_DIR = 'launch';
const EXTERNAL = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;

type Report = (file: string, line: number, message: string) => void;

function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Every Markdown file under `dir` (relative to `root`), at any depth, sorted, with forward slashes. */
function markdownUnder(root: string, dir: string): string[] {
  const full = path.join(root, dir);
  if (!existsSync(full) || !statSync(full).isDirectory()) return [];
  return readdirSync(full, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}/${name.split(path.sep).join('/')}`)
    .sort(byCodeUnit);
}

/**
 * The documents checked, relative to the root: docs/*.md (not recursive), README.md and PRIVACY.md, then those of
 * RELEASE_DOCS that exist and every Markdown file under launch/.
 */
export function docFiles(root: string): string[] {
  const docsDir = path.join(root, 'docs');
  const docs = existsSync(docsDir)
    ? readdirSync(docsDir)
        .filter((name) => name.endsWith('.md'))
        .sort()
        .map((name) => `docs/${name}`)
    : [];
  const release = RELEASE_DOCS.filter((file) => existsSync(path.join(root, file)));
  return [...docs, ...ROOT_DOCS, ...release, ...markdownUnder(root, LAUNCH_DIR)];
}

function readText(root: string, file: string): string | null {
  const full = path.join(root, file);
  return existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
}

function readJson(root: string, file: string): unknown {
  const text = readText(root, file);
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rule ids from policy/default.json, in policy order. */
function policyRuleIds(root: string, report: Report): string[] {
  const json = readJson(root, POLICY_FILE);
  const rules = isRecord(json) ? json.rules : undefined;
  const ids = Array.isArray(rules) ? rules.map((rule) => (isRecord(rule) ? rule.id : undefined)) : [];
  if (!Array.isArray(rules) || ids.some((id) => typeof id !== 'string')) {
    report(POLICY_FILE, 0, 'cannot read rule ids from "rules" (each rule needs a string "id")');
  }
  return ids.filter((id): id is string => typeof id === 'string');
}

/** Resolves a link target from a document; null when it leaves the root. */
function resolveTarget(root: string, docFile: string, pathPart: string): string | null {
  const base = pathPart.startsWith('/') ? root : path.join(root, path.dirname(docFile));
  const resolved = path.resolve(base, `.${path.sep}${pathPart.replace(/^\/+/, '')}`);
  const relative = path.relative(root, resolved);
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return outside ? null : resolved;
}

/**
 * The path as stored on disk when `relative` (an existing path under `root`) is spelled with different letter
 * case, else null. GitHub and Linux compare paths case-sensitively, but a case-insensitive file system (the
 * default on macOS and Windows) finds `docs/Grading.md` for `docs/grading.md`, so `existsSync` alone passes a
 * link that is broken on GitHub.
 */
function caseMismatch(root: string, relative: string): string | null {
  let dir = root;
  let differs = false;
  const actual: string[] = [];
  for (const segment of relative.split(path.sep).filter((part) => part !== '')) {
    const entries = readdirSync(dir);
    const found = entries.includes(segment)
      ? segment
      : entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
    if (found === undefined) return null;
    differs ||= found !== segment;
    actual.push(found);
    dir = path.join(dir, found);
  }
  return differs ? actual.join('/') : null;
}

/** The problem with a link path that resolved inside the root, or null when it names an existing entry. */
function pathProblem(root: string, target: string, pathPart: string, resolved: string): string | null {
  const relative = path.relative(root, resolved);
  const shown = relative.split(path.sep).join('/');
  if (!existsSync(resolved)) return `broken link '${target}': ${shown} does not exist`;
  const onDisk = caseMismatch(root, relative);
  if (onDisk !== null) return `broken link '${target}': ${shown} differs in letter case from ${onDisk}`;
  if (pathPart.endsWith('/') && !statSync(resolved).isDirectory()) {
    return `broken link '${target}': ${shown} is a file, not a directory`;
  }
  return null;
}

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** Anchors of a Markdown file, memoised per check. */
type AnchorLookup = (file: string) => ReadonlySet<string>;

/** The problem with one relative link, or null when it resolves. */
function linkProblem(root: string, docFile: string, target: string, anchorsOf: AnchorLookup): string | null {
  const hash = target.indexOf('#');
  const rawPath = hash === -1 ? target : target.slice(0, hash);
  const pathPart = decode(rawPath.split('?')[0] ?? '');
  const anchor = hash === -1 ? undefined : decode(target.slice(hash + 1));
  if (pathPart === null || anchor === null) return `link '${target}' is not valid percent-encoding`;
  if (target === '') return 'empty link target';
  let targetFile = docFile;
  if (pathPart !== '') {
    const resolved = resolveTarget(root, docFile, pathPart);
    if (resolved === null) return `link '${target}' points outside the repository`;
    const problem = pathProblem(root, target, pathPart, resolved);
    if (problem !== null) return problem;
    targetFile = path.relative(root, resolved).split(path.sep).join('/');
  }
  if (anchor === undefined || anchor === '' || !targetFile.endsWith('.md')) return null;
  return anchorsOf(targetFile).has(anchor)
    ? null
    : `broken anchor '${target}': no heading '#${anchor}' in ${targetFile}`;
}

function checkLinks(root: string, file: string, scan: MarkdownScan, anchorsOf: AnchorLookup, report: Report) {
  let count = 0;
  for (const link of scan.links) {
    if (EXTERNAL.test(link.target)) continue;
    count += 1;
    const problem = linkProblem(root, file, link.target, anchorsOf);
    if (problem !== null) report(file, link.line, problem);
  }
  return count;
}

/** Checks every quoted pnpm command; a `cd` (and an open subshell) carries from one line of a code block to the next. */
function checkCommands(file: string, scan: MarkdownScan, workspace: Workspace, report: Report) {
  let count = 0;
  const shells = new Map<number, ShellState>();
  for (const code of scan.code) {
    const shell = shells.get(code.block) ?? AT_REPO_ROOT;
    shells.set(code.block, shellAfter(code.text, shell));
    for (const invocation of pnpmInvocations(code.text, shell)) {
      count += 1;
      if (invocation.script === null) continue;
      const found = scriptsFor(workspace, invocation.target);
      if ('problem' in found) report(file, code.line, `'${invocation.text}': ${found.problem}`);
      else if (!found.scripts.has(invocation.script)) {
        report(file, code.line, `'${invocation.text}': no script '${invocation.script}' in ${found.where}`);
      }
    }
  }
  return count;
}

/** Inline code span contents outside code blocks and HTML comments. */
function inlineCodeSpans(source: string): Set<string> {
  const spans = new Set<string>();
  for (const line of splitBlocks(source).prose) {
    for (const part of segments(line.text)) if (part.code) spans.add(part.text);
  }
  return spans;
}

function checkRuleIds(root: string, report: Report): number {
  const ids = policyRuleIds(root, report);
  const grading = readText(root, GRADING_DOC);
  if (grading === null) {
    report(GRADING_DOC, 0, 'missing: every rule id in policy/default.json must be documented here');
    return ids.length;
  }
  const spans = inlineCodeSpans(grading);
  for (const id of ids) {
    if (!spans.has(id))
      report(GRADING_DOC, 0, `rule id '${id}' from ${POLICY_FILE} does not appear as \`${id}\``);
  }
  return ids.length;
}

/** Runs every check under `root` and returns the problems, sorted by file, line and message. */
export function checkDocs(root: string): DocCheckResult {
  const problems: DocProblem[] = [];
  const report: Report = (file, line, message) => problems.push({ file, line, message });
  const scans = new Map<string, MarkdownScan>();
  const scanOf = (file: string): MarkdownScan | null => {
    const cached = scans.get(file);
    if (cached !== undefined) return cached;
    const text = readText(root, file);
    if (text === null) return null;
    const scan = scanMarkdown(text);
    scans.set(file, scan);
    return scan;
  };
  const anchorsOf: AnchorLookup = (file) => scanOf(file)?.anchors ?? new Set<string>();
  const workspace = workspacePackages(root, report);
  const files = docFiles(root);
  let links = 0;
  let commands = 0;
  for (const file of files) {
    const scan = scanOf(file);
    if (scan === null) {
      report(file, 0, 'missing');
      continue;
    }
    links += checkLinks(root, file, scan, anchorsOf, report);
    commands += checkCommands(file, scan, workspace, report);
  }
  const ruleIds = checkRuleIds(root, report);
  const scenario = scenarioKeyProblems(readText(root, SCENARIO_SCHEMA), readText(root, GRADING_DOC));
  problems.push(...scenario.problems);
  const markdownFiles = checkLocalPaths(root, report);
  const decisionLines = checkDecisions(readText(root, DECISIONS_FILE), report);
  const allowlist = allowlistProblems(readText(root, POLICY_FILE), readText(root, PRIVACY_DOC));
  problems.push(...allowlist.problems);
  problems.sort((a, b) => byCodeUnit(a.file, b.file) || a.line - b.line || byCodeUnit(a.message, b.message));
  return {
    problems,
    files: files.length,
    links,
    commands,
    ruleIds,
    scenarioKeys: scenario.checked,
    markdownFiles,
    decisionLines,
    allowlistFields: allowlist.checked,
  };
}

export interface CliOutput {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

/** The command line: `[--root <dir>]`. Returns the exit code (0 clean, 1 problems, 2 usage). */
export function runCli(argv: readonly string[], output: CliOutput, defaultRoot: string = REPO_ROOT): number {
  let root = defaultRoot;
  if (argv.length > 0) {
    if (argv.length !== 2 || argv[0] !== '--root' || argv[1] === undefined) {
      output.error('usage: tsx scripts/check-docs.ts [--root <dir>]');
      return 2;
    }
    root = path.resolve(argv[1]);
  }
  const result = checkDocs(root);
  for (const problem of result.problems)
    output.error(`${problem.file}:${String(problem.line)}: ${problem.message}`);
  const counts = [
    `${String(result.files)} files`,
    `${String(result.links)} relative links`,
    `${String(result.commands)} pnpm commands`,
    `${String(result.ruleIds)} rule ids`,
    `${String(result.scenarioKeys)} scenario keys`,
    `${String(result.markdownFiles)} Markdown files read for local paths`,
    `${String(result.decisionLines)} Decisions.md lines checked for wording`,
    `${String(result.allowlistFields)} allowlisted fields checked`,
  ].join(', ');
  if (result.problems.length > 0) {
    output.error(`check-docs: ${String(result.problems.length)} problem(s) (${counts})`);
    return 1;
  }
  output.log(`check-docs: OK (${counts})`);
  return 0;
}

const invokedAs = process.argv[1];
if (invokedAs !== undefined && import.meta.url === pathToFileURL(path.resolve(invokedAs)).href) {
  process.exitCode = runCli(process.argv.slice(2), {
    log: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
  });
}
