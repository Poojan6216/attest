/**
 * One observer pass, decided (sprint_2 2.0; docs/grading.md §3 "Observer obligations"; Hard Rules 2, 3, 5, 6).
 *
 * `planPass` runs `health()` → `extract()` → `redact.project()` → `account()` / `visibleWindow()` over one
 * synchronous read of the page and says what the pass may report. It posts nothing (./base.ts does) and never
 * throws: every failure becomes a reason code on a DEGRADED plan.
 *
 *  - health DEGRADED (or `health()` threw or answered badly): nothing is extracted, no coverage.
 *  - `extract()` threw or returned something that is not a list of rows of this source: no observations, no coverage.
 *    An extractor that answers badly is broken, so none of its rows is trusted.
 *  - `project()` refused a row (`RedactError`): DEGRADED, no coverage for the window (a refused row is not evidence
 *    of absence, Hard Rule 5; Sprint 1 close, SEC-3). The rows it accepted are still reported: they are evidence.
 *  - the account or the window could not be read: DEGRADED, no coverage.
 *  - a Gmail window (`gmail.sent`, `gmail.receipt`) that ends after the pass instant: DEGRADED (`window.future`), no
 *    coverage. A list of what already happened cannot have been seen past the moment it was read (§3: `windowEnd`
 *    is `lastSyncAt` or the newest visible row); a window that claims more would let a later ping's sync time
 *    finalise a claim nobody looked at as NOT_FOUND (§6.1, Hard Rule 5). Only a calendar sees ahead.
 *  - otherwise OK, with the coverage facts. A coverage entry exists only for a clean pass whose health was OK.
 *
 * Every observation carries `observedAt = ctx.observedAt`, the instant the pass read the page (§3, §10): never the
 * instant the background writes it. Observations with one `contentHash` are reported once (§10: the same row read
 * twice is one observation).
 */
import { instantMs } from '../core/normalize';
import type { Policy } from '../core/policy';
import { z } from 'zod';

import { project, RedactError } from '../core/redact';
import {
  ActionType,
  HealthReport,
  IsoTs,
  type Observation,
  type ObservationSource,
  type Sha256,
} from '../core/schema';
import { accountHashOf } from './account';
import type { ExtractContext, HealthCheck, Observer, RawRow } from './types';

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
  'message.invalid',
] as const);

/**
 * The sources whose visible window may end after the pass instant: a calendar shows days to come. Every other
 * source is a list of what already happened, so its window ends at the pass instant at the latest (§3).
 */
const SEES_AHEAD: ReadonlySet<ObservationSource> = new Set<ObservationSource>(['gcal.event']);

export type PassReason = (typeof PASS_REASONS)[number];

/** The parts of the loaded policy a pass reads: the allowlist and which source serves which type. */
export type PassPolicy = Pick<Policy, 'allowlistedFields' | 'sourcesByType'>;

/** What the coverage ping asserts about a clean pass (the skeleton adds the observer, the instant and activity). */
export interface CoverageFacts {
  readonly windowStart: IsoTs;
  readonly windowEnd: IsoTs;
  readonly accountHash?: Sha256;
}

export type PassPlan =
  | {
      readonly status: 'OK';
      readonly observations: readonly Observation[];
      readonly coverage: CoverageFacts;
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

type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: PassReason };

const ok = <T>(value: T): Step<T> => ({ ok: true, value });
const fail = <T>(reason: PassReason): Step<T> => ({ ok: false, reason });

/**
 * A `HealthCheck` as the contract allows it: OK, or DEGRADED with 1 to SCHEMA_LIMITS.REASONS reason codes. A reason
 * that is not a code (a sentence, text the page held) fails it (Hard Rule 2).
 */
const HealthCheckShape = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('OK') }),
  z.strictObject({ status: z.literal('DEGRADED'), reasons: HealthReport.shape.reasons.min(1) }),
]);

/** The observer's health, checked against the contract: `health.threw` or `health.invalid` when it is not. */
function checkHealth(observer: Observer, doc: Document): HealthCheck {
  let check: unknown;
  try {
    check = observer.health(doc);
  } catch {
    return { status: 'DEGRADED', reasons: ['health.threw'] };
  }
  const parsed = HealthCheckShape.safeParse(check);
  if (!parsed.success) return { status: 'DEGRADED', reasons: ['health.invalid'] };
  if (parsed.data.status === 'OK') return { status: 'OK' };
  const [first, ...rest] = parsed.data.reasons;
  return first === undefined
    ? { status: 'DEGRADED', reasons: ['health.invalid'] }
    : { status: 'DEGRADED', reasons: [first, ...rest] };
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

/** The account's hash, undefined when the page shows none. */
function readAccount(input: PassInput): Step<Sha256 | undefined> {
  let raw: unknown;
  try {
    raw = input.observer.account(input.doc);
  } catch {
    return fail('account.threw');
  }
  if (raw === null) return ok(undefined);
  const hash = typeof raw === 'string' ? accountHashOf(raw) : null;
  return hash === null ? fail('account.invalid') : ok(hash);
}

/**
 * The visible window: two ISO instants with an offset, the start not after the end, and (except for a source that
 * sees ahead) the end not after the pass instant.
 */
function readWindow(input: PassInput): Step<{ windowStart: IsoTs; windowEnd: IsoTs }> {
  let span: unknown;
  try {
    span = input.observer.visibleWindow(input.doc, input.ctx);
  } catch {
    return fail('window.threw');
  }
  if (span === null) return fail('window.unknown');
  if (typeof span !== 'object') return fail('window.invalid');
  const { windowStart, windowEnd } = span as Partial<Record<'windowStart' | 'windowEnd', unknown>>;
  const start = IsoTs.safeParse(windowStart);
  const end = IsoTs.safeParse(windowEnd);
  if (!start.success || !end.success) return fail('window.invalid');
  if (instantMs(end.data) < instantMs(start.data)) return fail('window.invalid');
  const ahead = instantMs(end.data) > instantMs(input.ctx.observedAt);
  if (ahead && !SEES_AHEAD.has(input.observer.source)) return fail('window.future');
  return ok({ windowStart: start.data, windowEnd: end.data });
}

function coverageFacts(input: PassInput): Step<CoverageFacts> {
  const account = readAccount(input);
  if (!account.ok) return account;
  const span = readWindow(input);
  if (!span.ok) return span;
  return ok(account.value === undefined ? span.value : { ...span.value, accountHash: account.value });
}

/** Decides one pass over `input.doc`. Never throws. */
export function planPass(input: PassInput): PassPlan {
  const health = checkHealth(input.observer, input.doc);
  if (health.status === 'DEGRADED') return { status: 'DEGRADED', reasons: health.reasons, observations: [] };
  const rows = extractRows(input);
  if (!rows.ok) return { status: 'DEGRADED', reasons: [rows.reason], observations: [] };
  const { observations, reasons } = projectRows(input, rows.value);
  const coverage = coverageFacts(input);
  const [first, ...rest] = coverage.ok ? reasons : [...reasons, coverage.reason];
  if (first !== undefined) return { status: 'DEGRADED', reasons: [first, ...rest], observations };
  // Unreachable when coverage failed (its reason is in the list above); spelled out for the type checker.
  if (!coverage.ok) return { status: 'DEGRADED', reasons: [coverage.reason], observations };
  return { status: 'OK', observations, coverage: coverage.value };
}
