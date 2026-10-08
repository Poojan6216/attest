/**
 * One observer pass, decided (sprint_2 2.0, 2.7; docs/grading.md §3 "Observer obligations"; Hard Rules 2, 3, 5, 6).
 *
 * `planPass` runs `health()` → `extract()` → `redact.project()` → the windows, `allCalendars()`, the snapshot and
 * `account()` (./coverage.ts) over one synchronous read of the page and says what the pass may report. It posts
 * nothing (./base.ts does) and never throws: every failure becomes a reason code on a DEGRADED plan.
 *
 *  - health IDLE (the page is not one the observer reads: another Gmail folder, no conversation open): nothing is
 *    extracted, no coverage, and the plan says IDLE with the observer's reasons, neither OK nor DEGRADED (sprint_2
 *    2.11: the ledger keeps the status a page the observer reads gave, so a second tab never flips it).
 *  - health DEGRADED (or `health()` threw or answered badly): nothing is extracted, no coverage.
 *  - `extract()` threw or returned something that is not a list of rows of this source: no observations, no coverage.
 *    An extractor that answers badly is broken, so none of its rows is trusted.
 *  - `project()` refused a row (`RedactError`): DEGRADED, no coverage for the window (a refused row is not evidence
 *    of absence, Hard Rule 5; Sprint 1 close, SEC-3). The rows it accepted are still reported: they are evidence.
 *  - the account, a window, `allCalendars` or the snapshot could not be read: DEGRADED, no coverage, no snapshot.
 *  - a Gmail window (`gmail.sent`, `gmail.receipt`) that ends after the pass instant: DEGRADED (`window.future`), no
 *    coverage. A list of what already happened cannot have been seen past the moment it was read (§3: `windowEnd`
 *    is `lastSyncAt` or the newest visible row); a window that claims more would let a later ping's sync time
 *    finalise a claim nobody looked at as NOT_FOUND (§6.1, Hard Rule 5). Only a calendar sees ahead.
 *  - otherwise OK, with one set of coverage facts per window. A coverage entry exists only for a clean pass whose
 *    health was OK.
 *  - a clean pass whose observer reports no window, by design (`visibleWindows()` answered []: a Sent page past the
 *    head of the list, an opened conversation with no receipt, a Calendar grid still drawing): `OK_NO_COVERAGE`, health
 *    OK and the rows, never DEGRADED (Hard Rule 6 must not cry wolf over a page that is fine).
 * A clean pass of a Calendar observer whose account is known also carries the snapshot it read (sprint_2 2.7).
 *
 * Every observation carries `observedAt = ctx.observedAt`, the instant the pass read the page (§3, §10): never the
 * instant the background writes it. Observations with one `contentHash` are reported once (§10: the same row read
 * twice is one observation).
 */
import type { Policy } from '../core/policy';
import { z } from 'zod';

import { project, RedactError } from '../core/redact';
import { ActionType, HealthReport, type Observation } from '../core/schema';
import { type CoverageFacts, fail, ok, type PassCoverage, readCoverage, type Step } from './coverage';
import type { ExtractContext, HealthCheck, Observer, RawRow } from './types';

export type { CoverageFacts } from './coverage';

/**
 * Every reason a pass itself can give (an observer's `health()` adds its own, such as `not_sent_folder`). Codes,
 * never text (Hard Rules 2, 10). `message.invalid` is ./base.ts's: a message failed its bus schema.
 */
export const PASS_REASONS = Object.freeze([
  'health.threw',
  'health.invalid',
  'extract.threw',
  'extract.invalid',
  'extract.foreign_type',
  'redact.invalid_field',
  'redact.missing_occurred_at',
  'redact.invalid_argument',
  'redact.threw',
  'account.threw',
  'account.invalid',
  'window.threw',
  'window.unknown',
  'window.invalid',
  'window.future',
  'calendars.threw',
  'calendars.unknown',
  'calendars.invalid',
  'snapshot.threw',
  'message.invalid',
] as const);

export type PassReason = (typeof PASS_REASONS)[number];

/** The parts of the loaded policy a pass reads: the allowlist and which source serves which type. */
export type PassPolicy = Pick<Policy, 'allowlistedFields' | 'sourcesByType'>;

export type PassPlan =
  | {
      readonly status: 'OK';
      readonly observations: readonly Observation[];
      /** One entry per window the pass saw (./base.ts posts one coverage.ping each). */
      readonly coverage: readonly [CoverageFacts, ...CoverageFacts[]];
      /** The Calendar snapshot to post after the coverage, when the account is known. */
      readonly snapshot?: unknown;
    }
  | {
      /** A clean pass that asserts no coverage by design: health OK, the rows, no ping. */
      readonly status: 'OK_NO_COVERAGE';
      readonly observations: readonly Observation[];
      readonly snapshot?: unknown;
    }
  | {
      /** The page is not one the observer reads: nothing read, nothing posted but the health report. */
      readonly status: 'IDLE';
      readonly reasons: readonly [string, ...string[]];
      readonly observations: readonly [];
    }
  | {
      readonly status: 'DEGRADED';
      readonly reasons: readonly [string, ...string[]];
      readonly observations: readonly Observation[];
    };

export interface PassInput {
  readonly observer: Observer;
  readonly doc: Document;
  readonly ctx: ExtractContext;
  readonly policy: PassPolicy;
}

/**
 * A `HealthCheck` as the contract allows it: OK, or IDLE or DEGRADED with 1 to SCHEMA_LIMITS.REASONS reason codes. A
 * reason that is not a code (a sentence, text the page held) fails it (Hard Rule 2).
 */
const HealthCheckShape = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('OK') }),
  z.strictObject({ status: z.literal('IDLE'), reasons: HealthReport.shape.reasons.min(1) }),
  z.strictObject({ status: z.literal('DEGRADED'), reasons: HealthReport.shape.reasons.min(1) }),
]);

/** The observer's health, checked against the contract: `health.threw` or `health.invalid` when it is not. */
function checkHealth(observer: Observer, doc: Document, ctx: ExtractContext): HealthCheck {
  let check: unknown;
  try {
    check = observer.health(doc, ctx);
  } catch {
    return { status: 'DEGRADED', reasons: ['health.threw'] };
  }
  const parsed = HealthCheckShape.safeParse(check);
  if (!parsed.success) return { status: 'DEGRADED', reasons: ['health.invalid'] };
  if (parsed.data.status === 'OK') return { status: 'OK' };
  const [first, ...rest] = parsed.data.reasons;
  if (first === undefined) return { status: 'DEGRADED', reasons: ['health.invalid'] };
  return { status: parsed.data.status, reasons: [first, ...rest] };
}

function isRawRow(row: unknown): row is RawRow {
  if (typeof row !== 'object' || row === null) return false;
  const { type, rowKey, fields } = row as Partial<Record<keyof RawRow, unknown>>;
  return (
    ActionType.safeParse(type).success &&
    (rowKey === undefined || typeof rowKey === 'string') &&
    typeof fields === 'object' &&
    fields !== null &&
    !Array.isArray(fields)
  );
}

/** The rows `extract()` returned, each a RawRow of a type the policy reads from this observer's source. */
function extractRows(input: PassInput): Step<readonly RawRow[]> {
  let rows: unknown;
  try {
    rows = input.observer.extract(input.doc, input.ctx);
  } catch {
    return fail('extract.threw');
  }
  if (!Array.isArray(rows) || !rows.every(isRawRow)) return fail('extract.invalid');
  const served = (row: RawRow): boolean =>
    input.policy.sourcesByType[row.type].includes(input.observer.source);
  return rows.every(served) ? ok(rows) : fail('extract.foreign_type');
}

function refusal(error: unknown): PassReason {
  if (!(error instanceof RedactError)) return 'redact.threw';
  return `redact.${error.code}`;
}

/** Each row through `project()`; the accepted ones (one per contentHash) and why any was refused. */
function projectRows(
  input: PassInput,
  rows: readonly RawRow[],
): { observations: Observation[]; reasons: PassReason[] } {
  const observations: Observation[] = [];
  const reasons = new Set<PassReason>();
  const seen = new Set<string>();
  for (const row of rows) {
    try {
      const context = { type: row.type, observedAt: input.ctx.observedAt, rowKey: row.rowKey };
      const observation = project(input.observer.source, row.fields, context, input.policy);
      if (seen.has(observation.contentHash)) continue;
      seen.add(observation.contentHash);
      observations.push(observation);
    } catch (error) {
      reasons.add(refusal(error));
    }
  }
  return { observations, reasons: [...reasons] };
}

/** The clean plan: OK with its windows, or OK_NO_COVERAGE when it asserts none; the snapshot either way. */
function cleanPlan(observations: readonly Observation[], facts: PassCoverage): PassPlan {
  const snapshot = facts.snapshot === undefined ? {} : { snapshot: facts.snapshot };
  const [first, ...rest] = facts.coverage;
  if (first === undefined) return { status: 'OK_NO_COVERAGE', observations, ...snapshot };
  return { status: 'OK', observations, coverage: [first, ...rest], ...snapshot };
}

/** Decides one pass over `input.doc`. Never throws. */
export function planPass(input: PassInput): PassPlan {
  const health = checkHealth(input.observer, input.doc, input.ctx);
  if (health.status !== 'OK') return { status: health.status, reasons: health.reasons, observations: [] };
  const rows = extractRows(input);
  if (!rows.ok) return { status: 'DEGRADED', reasons: [rows.reason], observations: [] };
  const { observations, reasons } = projectRows(input, rows.value);
  // Read even after a refused row, so the report names every reason; a refused row still voids it (Hard Rule 5).
  const facts: Step<PassCoverage> = readCoverage(input);
  const [first, ...rest] = facts.ok ? reasons : [...reasons, facts.reason];
  if (first !== undefined) return { status: 'DEGRADED', reasons: [first, ...rest], observations };
  // Unreachable when the coverage failed (its reason is in the list above); spelled out for the type checker.
  if (!facts.ok) return { status: 'DEGRADED', reasons: [facts.reason], observations };
  return cleanPlan(observations, facts.value);
}
