/**
 * The Decisions.md wording check of scripts/check-docs.ts (TECH-R13): from the Sprint 1 close on, every entry says
 * what was decided and why, in project terms. Words about how the work on a change was organised (who held which
 * file, what a task's instructions said, which pass of the work wrote a line, a list of needs for another file) mean
 * nothing to a later reader, and the close found such entries stale against the code they described.
 *
 * Scope: Decisions.md, from the first `[1.close]` entry to the end. Earlier entries stay as written: the file's rule
 * is never delete an entry, supersede it. A fixture repository without Decisions.md has nothing to check.
 *
 * Reported, case-insensitively and as whole words: `ownershipNeeds`, `docsNeeds`, `fixer`, `ownership`, `brief`
 * (the word, so the adjective too: write "short"), `this run`, `first run`, `later agent`, `I own` / `I do not own`,
 * and `another owner` / `other owners` / `their owners`.
 */

/** The file checked, relative to the repository root. */
export const DECISIONS_FILE = 'Decisions.md';

/** The first entry checked: the Sprint 1 close. */
const FIRST_CHECKED = /^- \d{4}-\d{2}-\d{2} \[1\.close\]/;

/** Each residue term, and the pattern that finds it. */
const RESIDUE: readonly (readonly [term: string, pattern: RegExp])[] = [
  ['ownershipNeeds', /\bownershipNeeds\b/gi],
  ['docsNeeds', /\bdocsNeeds\b/gi],
  ['fixer', /\bfixers?\b/gi],
  ['ownership', /\bownership\b/gi],
  ['brief', /\bbrief(?:'s|s)?\b/gi],
  ['this run', /\bthis\s+run\b/gi],
  ['first run', /\bfirst\s+run\b/gi],
  ['later agent', /\blater\s+agents?\b/gi],
  ['I own', /\bI\s+(?:do\s+not\s+|don't\s+)?own\b/gi],
  ['another owner', /\b(?:another|other|their)\s+owners?\b/gi],
];

/** One residue term on one line. */
export interface Residue {
  /** 1-based line in Decisions.md. */
  readonly line: number;
  readonly term: string;
  /** The text as written. */
  readonly found: string;
}

/** The checked lines of `text` (Decisions.md), from the first `[1.close]` entry on, with their 1-based numbers. */
function checkedLines(text: string): { line: number; text: string }[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => FIRST_CHECKED.test(line));
  return start === -1
    ? []
    : lines.slice(start).map((line, offset) => ({ line: start + offset + 1, text: line }));
}

/** Every residue term in the checked part of `text` (Decisions.md), in line order, then term order. */
export function decisionResidue(text: string): Residue[] {
  return checkedLines(text).flatMap(({ line, text: written }) =>
    RESIDUE.flatMap(([term, pattern]) =>
      [...written.matchAll(pattern)].map((match) => ({ line, term, found: match[0] })),
    ),
  );
}

/** Checks Decisions.md (`text`, null when the file is missing); returns how many of its lines were checked. */
export function checkDecisions(
  text: string | null,
  report: (file: string, line: number, message: string) => void,
): number {
  if (text === null) return 0;
  for (const hit of decisionResidue(text)) {
    report(
      DECISIONS_FILE,
      hit.line,
      `'${hit.found}' describes how the work was organised, not the decision: write it in project terms`,
    );
  }
  return checkedLines(text).length;
}
