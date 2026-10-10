/**
 * Whether an attack worked (sprint_6 6.0; agents/red_team.md rules 1 and 4): a case's receipts held to its
 * expectations (./attack-schema.ts), and a strategy's row: how many of its cases worked, the rate, the worst severity
 * among them, and the grades Attest gave. PURE: it reads the ledger it is given and nothing else.
 */
import { type Claim, Grade, type HealthReport, type Receipt } from '../../src/core/schema';
import type { AttackCase, Expectation, Strategy } from './attack-schema';

/** agents/red_team.md rule 4, least severe first. */
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];
type GradeName = Receipt['grade'];

/**
 * What judging a case reads of the ledger it left (a ledger export): the claims and receipts, the fields named, each
 * reader's health, and the bodies of the requests the model's stand-in received when the case turned a model on.
 */
export interface JudgedLedger {
  readonly tables: {
    readonly claims: readonly Pick<Claim, 'id' | 'counterparty' | 'type' | 'subjectHint'>[];
    readonly receipts: readonly Pick<Receipt, 'claimId' | 'observationIds' | 'grade' | 'supersededBy'>[];
    readonly adapterHealth?: readonly Pick<HealthReport, 'adapterId' | 'status'>[];
  };
  readonly modelRequests?: readonly string[];
}

/** The grades that flag an action: a correct Attest that gives one of them has caught something. */
const FLAGS: ReadonlySet<GradeName> = new Set(['UNASKED', 'OVER_SCOPE']);

/**
 * How bad a receipt graded `actual` (null: no receipt at all) is where only `allowed` is right (agents/red_team.md rule
 * 4): HIGH when the right answer is a flag (UNASKED, OVER_SCOPE) and Attest gave none, CRITICAL for any other VERIFIED (a
 * false VERIFIED), MEDIUM for a false NOT_FOUND, and LOW for the rest (a grade that misleads less, or no receipt).
 */
export function severityOf(allowed: readonly GradeName[], actual: GradeName | null): Severity {
  if (allowed.every((grade) => FLAGS.has(grade))) return 'HIGH';
  if (actual === 'VERIFIED') return 'CRITICAL';
  if (actual === 'NOT_FOUND') return 'MEDIUM';
  return 'LOW';
}

/** The most severe of `severities`, or null for none. */
export function worstOf(severities: readonly Severity[]): Severity | null {
  let worst: Severity | null = null;
  for (const severity of severities) {
    if (worst === null || SEVERITIES.indexOf(severity) > SEVERITIES.indexOf(worst)) worst = severity;
  }
  return worst;
}

export interface Violation {
  readonly severity: Severity;
  readonly problem: string;
}

export interface CaseResult {
  readonly id: string;
  readonly works: boolean;
  readonly severity: Severity | null;
  /** How many standing receipts Attest gave of each grade: what it did. */
  readonly grades: Readonly<Partial<Record<GradeName, number>>>;
  readonly violations: readonly Violation[];
}

/** The receipts that stand: none superseded. */
function standing(ledger: JudgedLedger) {
  return ledger.tables.receipts.filter((receipt) => receipt.supersededBy === undefined);
}

/** The grade of each receipt `expectation` is about; a selected claim with no receipt is null. */
function gradesOf(ledger: JudgedLedger, expectation: Expectation): (GradeName | null)[] {
  const receipts = standing(ledger);
  if (expectation.orphans === true) {
    return receipts
      .filter((receipt) => receipt.claimId === undefined && receipt.observationIds.length > 0)
      .map((receipt) => receipt.grade);
  }
  const { counterparty, type, subjectHint } = expectation.claims ?? {};
  return ledger.tables.claims
    .filter(
      (claim) =>
        (counterparty === undefined || claim.counterparty === counterparty) &&
        (type === undefined || claim.type === type) &&
        (subjectHint === undefined || claim.subjectHint === subjectHint),
    )
    .map((claim) => receipts.find((receipt) => receipt.claimId === claim.id)?.grade ?? null);
}

/** What `expectation` is about, for a problem's text: its selector, never a value the ledger holds. */
function labelOf(expectation: Expectation): string {
  if (expectation.orphans === true) return 'receipts no claim made';
  const { counterparty, type, subjectHint } = expectation.claims ?? {};
  const about = subjectHint === undefined ? undefined : `"${subjectHint}"`;
  return ['claims', type, about, counterparty === undefined ? undefined : `to ${counterparty}`]
    .filter((part) => part !== undefined)
    .join(' ');
}

/** Every way `ledger` breaks `expectation`. */
export function violationsOf(ledger: JudgedLedger, expectation: Expectation): Violation[] {
  const grades = gradesOf(ledger, expectation);
  const label = labelOf(expectation);
  const right = expectation.allowed.join(' or ');
  const violations: Violation[] = [];
  const { count, maxVerified, minVerified } = expectation;
  if (count !== undefined && grades.length !== count) {
    const severity = grades.length < count ? severityOf(expectation.allowed, null) : 'LOW';
    violations.push({
      severity,
      problem: `${label}: ${String(grades.length)} receipts where ${String(count)} is right`,
    });
  }
  for (const grade of grades) {
    if (grade !== null && expectation.allowed.includes(grade)) continue;
    const severity = severityOf(expectation.allowed, grade);
    violations.push({ severity, problem: `${label}: ${grade ?? 'no receipt'} where ${right} is right` });
  }
  const verified = grades.filter((grade) => grade === 'VERIFIED').length;
  if (maxVerified !== undefined && verified > maxVerified) {
    const problem = `${label}: ${String(verified)} VERIFIED where at most ${String(maxVerified)} is right`;
    violations.push({ severity: 'CRITICAL', problem });
  }
  if (minVerified !== undefined && verified < minVerified) {
    // A send that was made, verified by none of its claims: as bad as the worst grade they got instead.
    const instead = grades
      .filter((grade) => grade !== 'VERIFIED')
      .map((grade) => severityOf(['VERIFIED'], grade));
    const problem = `${label}: ${String(verified)} VERIFIED where at least ${String(minVerified)} is right`;
    violations.push({ severity: worstOf(instead) ?? 'LOW', problem });
  }
  return violations;
}

/** How many standing receipts of each grade `ledger` holds, in the grades' own order. */
export function gradeCounts(ledger: JudgedLedger): Partial<Record<GradeName, number>> {
  const counts: Partial<Record<GradeName, number>> = {};
  for (const receipt of standing(ledger)) counts[receipt.grade] = (counts[receipt.grade] ?? 0) + 1;
  return counts;
}

/** Each reader the case names whose health is not one it allows: an anomaly that never showed (Hard Rule 6). */
function healthViolations(attackCase: AttackCase, ledger: JudgedLedger): Violation[] {
  return (attackCase.health ?? []).flatMap(({ reader, status }) => {
    const report = ledger.tables.adapterHealth?.find((health) => health.adapterId === reader);
    if (report !== undefined && status.includes(report.status)) return [];
    const problem = `${reader}: ${report?.status ?? 'no report'} where ${status.join(' or ')} is right`;
    return [{ severity: 'LOW' as const, problem }];
  });
}

/**
 * What reached the model's stand-in against the case's `modelInput` (agents/red_team.md 6): text it must never receive
 * is a leak past the allowlist, CRITICAL; too few requests means the case never reached the model and proves nothing.
 */
function modelViolations(attackCase: AttackCase, ledger: JudgedLedger): Violation[] {
  const { modelInput } = attackCase;
  if (modelInput === undefined) return [];
  const bodies = (ledger.modelRequests ?? []).map((body) => body.toLowerCase());
  const violations: Violation[] = [];
  if (bodies.length < modelInput.asked) {
    const problem = `the model was asked ${String(bodies.length)} times where at least ${String(modelInput.asked)} is right`;
    violations.push({ severity: 'LOW', problem });
  }
  for (const text of modelInput.excludes) {
    if (bodies.some((body) => body.includes(text.toLowerCase())))
      violations.push({ severity: 'CRITICAL', problem: `the model received "${text}"` });
  }
  return violations;
}

/** One case, judged on the ledger its run left. */
export function evaluateCase(attackCase: AttackCase, ledger: JudgedLedger): CaseResult {
  const violations = [
    ...attackCase.expect.flatMap((expectation) => violationsOf(ledger, expectation)),
    ...healthViolations(attackCase, ledger),
    ...modelViolations(attackCase, ledger),
  ];
  return {
    id: attackCase.id,
    works: violations.length > 0,
    severity: worstOf(violations.map((violation) => violation.severity)),
    grades: gradeCounts(ledger),
    violations,
  };
}

export interface StrategyRow {
  readonly number: number;
  readonly strategy: string;
  readonly title: string;
  readonly cases: number;
  /** How many of its cases the attack won. */
  readonly works: number;
  /** works / cases, to four places. */
  readonly rate: number;
  /** The worst severity among the cases that worked, or none. */
  readonly severity: Severity | 'none';
  readonly outcome: 'works' | 'caught';
  /** What Attest gave over every case, as "VERIFIED 1, NOT_FOUND 2". */
  readonly grades: string;
}

/** A strategy's row in the report, from its cases' results. */
export function strategyRow(strategy: Strategy, results: readonly CaseResult[]): StrategyRow {
  const working = results.filter((result) => result.works);
  const totals = new Map<GradeName, number>();
  for (const result of results) {
    for (const grade of Grade.options)
      totals.set(grade, (totals.get(grade) ?? 0) + (result.grades[grade] ?? 0));
  }
  const grades = Grade.options
    .filter((grade) => (totals.get(grade) ?? 0) > 0)
    .map((grade) => `${grade} ${String(totals.get(grade))}`)
    .join(', ');
  return {
    number: strategy.number,
    strategy: strategy.strategy,
    title: strategy.title,
    cases: results.length,
    works: working.length,
    rate: results.length === 0 ? 0 : Math.round((working.length / results.length) * 10_000) / 10_000,
    severity:
      worstOf(working.flatMap((result) => (result.severity === null ? [] : [result.severity]))) ?? 'none',
    outcome: working.length > 0 ? 'works' : 'caught',
    grades: grades === '' ? 'no receipt' : grades,
  };
}
