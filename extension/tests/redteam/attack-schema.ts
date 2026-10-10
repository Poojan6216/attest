/**
 * The red team's fixtures (sprint_6 6.0; agents/red_team.md): one folder per strategy under
 * tests/fixtures/attacks/<strategy>/, holding `expected.json` (this schema) and the pages its cases serve. A fixture is
 * input the harness does not trust, so each is parsed here before anything runs, and a bad one fails naming its file.
 *
 * A case opens its pages at their vendor addresses in the built extension, pastes its agents' logs in the side panel,
 * and holds the receipts Attest then issues to its expectations. An expectation names the receipts it is about (the
 * claims with a counterparty or a type, or the receipts no claim made) and the grades a correct Attest may give them;
 * any other grade is the attack working, at the severity agents/red_team.md rule 4 gives it (./outcome.ts). Every time
 * in a case is minutes before the run, so a case means the same on any day, and every value in it is invented.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { ActionType, AgentId, Grade } from '../../src/core/schema';

/** The file each strategy's folder holds. */
export const EXPECTED_FILE = 'expected.json';
/** The hosts Attest reads (build_spec §5): a served page reaches Attest's readers only at one of these. */
export const VENDOR_ORIGINS = ['https://mail.google.com', 'https://calendar.google.com'] as const;
/** How far a case's time may be from the run, either way: a week, inside every retention choice (30 days at least). */
const MAX_MINUTES_AGO = 7 * 24 * 60;

/** A name as folders and metrics carry it: lowercase words joined by hyphens. */
const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
/** Minutes before the run; below zero, after it (a claim stamped in the future). */
const MinutesAgo = z.number().int().min(-MAX_MINUTES_AGO).max(MAX_MINUTES_AGO);
const Text = z.string().max(500);

/** One row of Gmail's Sent list, served as the synthetic Sent head with its rows replaced (../e2e/support/demo.ts). */
const SentRow = z.strictObject({
  name: Text.min(1),
  email: Text.min(3),
  subject: Text,
  snippet: Text,
  minutesAgo: MinutesAgo,
});

const isVendorUrl = (value: string): boolean => {
  try {
    return (VENDOR_ORIGINS as readonly string[]).includes(new URL(value).origin);
  } catch {
    return false;
  }
};

export const AttackPage = z.discriminatedUnion('kind', [
  /** Gmail's Sent list holding `rows`, newest first, as Gmail draws them. */
  z.strictObject({ kind: z.literal('gmail.sent'), rows: z.array(SentRow).min(1).max(100) }),
  /** A page of the strategy's own, `file` in its folder, served at `url`, a Gmail or Calendar address. */
  z.strictObject({
    kind: z.literal('file'),
    file: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.html$/u),
    url: z.string().refine(isVendorUrl, 'a Gmail or Google Calendar address'),
  }),
]);

/** What an agent says it did: its activity log, pasted in the side panel (docs/claims-import.md). */
export const AttackLog = z.strictObject({
  agent: AgentId,
  lines: z
    .array(
      z.strictObject({
        text: Text.min(1),
        minutesAgo: MinutesAgo,
        /** How its time is written: in the browser's zone, as logs write it (the default), or in UTC, saying so. */
        clock: z.enum(['local', 'utc']).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const Expectation = z
  .strictObject({
    /** The receipts of the claims matching every field given. */
    claims: z
      .strictObject({
        counterparty: Text.min(1).optional(),
        type: ActionType.optional(),
        subjectHint: Text.min(1).optional(),
      })
      .optional(),
    /** The receipts no claim made: an action Attest found and no claim explains (UNASKED, docs/grading.md §7). */
    orphans: z.literal(true).optional(),
    /** How many receipts the selection holds when Attest is right: one for a claim pasted twice. */
    count: z.number().int().min(0).optional(),
    /** The grades a correct Attest may give each selected receipt. */
    allowed: z.array(Grade).min(1),
    /** The most of them that may be VERIFIED: one row verifies one claim at most (agents/red_team.md 1). */
    maxVerified: z.number().int().min(0).optional(),
    /** The fewest that must be VERIFIED: a send that was made verifies one of the claims about it. */
    minVerified: z.number().int().min(0).optional(),
  })
  .refine((e) => (e.claims === undefined) !== (e.orphans === undefined), 'name either claims or orphans');

export const AttackCase = z.strictObject({
  id: Slug,
  /** What the case tries, in one line. */
  attack: Text.min(1),
  pages: z.array(AttackPage).max(10),
  /** What the agents say they did: each log pasted in turn, as a person pastes one agent's activity after another. */
  logs: z.array(AttackLog).max(10).optional(),
  expect: z.array(Expectation).min(1),
});

export const AttackFile = z.strictObject({
  /** The strategy's number in agents/red_team.md (1 to 13), or a new one past them. */
  number: z.number().int().min(1).max(99),
  strategy: Slug,
  title: Text.min(1),
  cases: z.array(AttackCase).min(1),
});

export type AttackPage = z.infer<typeof AttackPage>;
export type AttackLog = z.infer<typeof AttackLog>;
export type Expectation = z.infer<typeof Expectation>;
export type AttackCase = z.infer<typeof AttackCase>;
export type AttackFile = z.infer<typeof AttackFile>;

/** A strategy as loaded: its file, and the folder its pages are read from. */
export interface Strategy extends AttackFile {
  readonly dir: string;
}

/** The problems with one strategy folder's parsed file, or none. */
function problemsOf(dir: string, file: AttackFile): string[] {
  const problems: string[] = [];
  if (file.strategy !== path.basename(dir))
    problems.push(`strategy must be "${path.basename(dir)}" (its folder)`);
  const ids = file.cases.map((attackCase) => attackCase.id);
  if (new Set(ids).size !== ids.length) problems.push('case ids must be unique');
  for (const attackCase of file.cases) {
    for (const page of attackCase.pages) {
      if (page.kind === 'file' && !existsSync(path.join(dir, page.file)))
        problems.push(`${attackCase.id}: ${page.file} is not in the folder`);
    }
  }
  return problems;
}

/** One strategy folder's `expected.json`, checked; throws naming the file and every problem. */
export function loadStrategy(dir: string): Strategy {
  const at = path.join(dir, EXPECTED_FILE);
  const where = path.relative(process.cwd(), at);
  if (!existsSync(at)) throw new Error(`${where}: missing`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(at, 'utf8'));
  } catch {
    throw new Error(`${where}: not JSON`);
  }
  const parsed = AttackFile.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`,
    );
    throw new Error(`${where}: ${issues.join('; ')}`);
  }
  const problems = problemsOf(dir, parsed.data);
  if (problems.length > 0) throw new Error(`${where}: ${problems.join('; ')}`);
  return { ...parsed.data, dir };
}

/**
 * Every strategy under `dir`, one per folder, by number. An empty folder holds none; a folder that is missing throws,
 * so a mistyped path is never an empty report (Hard Rule 12), and so do two strategies with one number.
 */
export function loadAttacks(dir: string): Strategy[] {
  if (!existsSync(dir)) throw new Error(`${dir}: no attacks folder`);
  const strategies = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadStrategy(path.join(dir, entry.name)))
    .sort((a, b) => a.number - b.number);
  const numbers = strategies.map((strategy) => strategy.number);
  if (new Set(numbers).size !== numbers.length) throw new Error(`${dir}: two strategies share a number`);
  return strategies;
}
