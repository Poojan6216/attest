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

import { ActionType, AgentId, Grade, IsoTs } from '../../src/core/schema';

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

/**
 * A time in a served page, as Gmail writes it in a title ("Sat, Oct 10, 2026, 2:55 PM"), `minutes` before the run:
 * `{{gmailTime:<minutes>}}`, filled in by the runner, so a page's dates mean the same on any day.
 */
export const GMAIL_TIME = /\{\{gmailTime:(-?\d+)\}\}/gu;

/** Where a page plants Sent rows of its own, beside Gmail's list (agents/red_team.md 5: DOM spoofing). */
export const SPOOF_PLACES = ['outside-main', 'second-main', 'iframe', 'hidden-row'] as const;

const HtmlFile = z.string().regex(/^[a-z0-9][a-z0-9.-]*\.html$/u);

export const AttackPage = z.discriminatedUnion('kind', [
  /**
   * Gmail's Sent list holding `rows`, newest first, as Gmail draws them; with `spoof`, rows of the page's own planted
   * beside it: after the main landmark, in a second main landmark, in a main landmark inside another origin's iframe, or
   * hidden inside Gmail's list.
   */
  z.strictObject({
    kind: z.literal('gmail.sent'),
    rows: z.array(SentRow).min(1).max(100),
    spoof: z.strictObject({ at: z.enum(SPOOF_PLACES), rows: z.array(SentRow).min(1).max(10) }).optional(),
  }),
  /** A page of the strategy's own, `file` in its folder, served at `url`, a Gmail or Calendar address. */
  z.strictObject({
    kind: z.literal('file'),
    file: HtmlFile,
    url: z.string().refine(isVendorUrl, 'a Gmail or Google Calendar address'),
  }),
  /**
   * A labelled page of the shared fixtures (tests/fixtures/pages), served at its own address, with each `from` text
   * replaced by its `to` (a forged sender, amount or time); a `from` the page does not hold fails the run.
   */
  z.strictObject({
    kind: z.literal('fixture'),
    vendor: z.enum(['gmail', 'gcal']),
    file: HtmlFile,
    replace: z
      .array(z.strictObject({ from: Text.min(1), to: Text }))
      .max(20)
      .optional(),
  }),
]);

/** What an agent says it did: its activity log, pasted in the side panel (docs/claims-import.md). */
export const AttackLog = z.strictObject({
  agent: AgentId,
  lines: z
    .array(
      z
        .strictObject({
          text: Text.min(1),
          /** When the line says it happened: minutes before the run, or `at`, an instant of its own. */
          minutesAgo: MinutesAgo.optional(),
          /**
           * A fixed instant, for a case whose pages are fixed in time (a captured Calendar week, whose events a claim
           * made after them can never name: a claim's event time is read forward from the claim).
           */
          at: IsoTs.optional(),
          /** How its time is written: in the browser's zone, as logs write it (the default), or in UTC, saying so. */
          clock: z.enum(['local', 'utc']).optional(),
        })
        .refine(
          (line) => (line.minutesAgo === undefined) !== (line.at === undefined),
          'give minutesAgo or at',
        ),
    )
    .min(1)
    .max(100),
});

/** An agent's grant, set in the options page as a person sets it (sprint_4 4.4), before anything is pasted. */
const AttackGrant = z.strictObject({
  agent: AgentId,
  /** The spend ceiling, a whole number in `currency`'s main unit (the form's own rule). */
  spendCeiling: z.number().int().min(0).max(1_000_000).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .optional(),
  /** Actions the agent may not take: their boxes unticked. */
  denied: z.array(ActionType).max(9).optional(),
  /** The domains or addresses it may write to, one a line. */
  mayWriteTo: z.array(Text.min(1)).max(20).optional(),
});

/** A span the person was away from the computer, as away detection records one: minutes before the run, from then to. */
const AwaySpan = z
  .strictObject({ fromMinutesAgo: MinutesAgo, toMinutesAgo: MinutesAgo })
  .refine((span) => span.fromMinutesAgo >= span.toMinutesAgo, 'from must not be after to');

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

export const AttackCase = z
  .strictObject({
    id: Slug,
    /** What the case tries, in one line. */
    attack: Text.min(1),
    pages: z.array(AttackPage).max(10),
    /** What the agents say they did: each log pasted in turn, as a person pastes one agent's activity after another. */
    logs: z.array(AttackLog).max(10).optional(),
    /**
     * The person's own model key, saved and on (sprint_5 5.3), its vendor a stand-in that scores every candidate it is
     * sent `score`, as a model obeying an injected instruction would (agents/red_team.md 6).
     */
    model: z.strictObject({ score: z.number().min(0).max(1) }).optional(),
    /** What the model's stand-in received: at least `asked` requests, so the case reaches it, and none of `excludes`. */
    modelInput: z
      .strictObject({ asked: z.number().int().min(1), excludes: z.array(Text.min(1)).min(1).max(20) })
      .optional(),
    /** Agents' grants, set before the logs are pasted. */
    grants: z.array(AttackGrant).max(4).optional(),
    /** When the person was away (Chrome reports it only live, so the run writes it, as the §2 demo's test does). */
    away: z.array(AwaySpan).max(10).optional(),
    /** Each named reader's health once the pages were read: an anomaly on a page must show (Hard Rule 6). */
    health: z
      .array(
        z.strictObject({
          reader: z.enum(['gmail.sent', 'gmail.receipt', 'gcal.event']),
          status: z.array(z.enum(['OK', 'IDLE', 'DEGRADED'])).min(1),
        }),
      )
      .max(5)
      .optional(),
    expect: z.array(Expectation).min(1),
  })
  .refine((c) => c.modelInput === undefined || c.model !== undefined, 'modelInput needs a model');

export const AttackFile = z.strictObject({
  /** The strategy's number in agents/red_team.md (1 to 13), or a new one past them. */
  number: z.number().int().min(1).max(99),
  strategy: Slug,
  title: Text.min(1),
  cases: z.array(AttackCase).min(1),
});

export type AttackPage = z.infer<typeof AttackPage>;
export type AttackLog = z.infer<typeof AttackLog>;
export type AttackGrant = z.infer<typeof AttackGrant>;
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
