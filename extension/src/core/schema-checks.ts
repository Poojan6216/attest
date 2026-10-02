/**
 * Cross-field invariants of the core schemas (docs/grading.md §3, §4.1, §7, §8, §10, §15), kept apart so
 * schema.ts stays one readable page. It imports nothing from ./schema (only ./hash and ./units, which sit
 * below it), so the two never form an import cycle. Each check returns the problems it found as
 * `[field, message]`; `refineWith` turns them into Zod issues whose path names the offending field. The closed
 * vocabularies live here too: a reason's params depend on its code (§15), and a receipt's signals are the §5.1
 * feature names plus `score` (§8). PURE (Hard Rule 4).
 */
import type { z } from 'zod';

import { idFromHash } from './hash';
import { MINUTES_PER_HOUR, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './units';

export type Problem = readonly [field: string, message: string];

/** A Zod `superRefine` callback that reports every problem `check` finds at its field's path. */
export function refineWith<T>(
  check: (value: T) => readonly Problem[],
): (value: T, ctx: z.RefinementCtx<T>) => void {
  return (value, ctx) => {
    for (const [field, message] of check(value)) ctx.addIssue({ code: 'custom', path: [field], message });
  };
}

/** `Z` or `±hh:mm` at the end: the only timestamps whose instant does not depend on the host's time zone. */
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;
/** The same suffix, with the numeric offset's parts named. */
const OFFSET_PARTS = /(?:Z|(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Epoch ms of an IsoTs, or NaN for a string without an explicit offset. Zod runs these checks even when a
 * field failed its own IsoTs check (already reported at that field), and `Date` reads an offset-less string
 * in the host's time zone, so such a string is never read (Hard Rule 4). Every check treats NaN as "nothing
 * to compare", so a bad timestamp is reported once, at its own path, the same way in every time zone.
 */
export function instantMs(isoTs: string): number {
  return EXPLICIT_OFFSET.test(isoTs) ? new Date(isoTs).getTime() : Number.NaN;
}

type State = 'PENDING' | 'FINAL' | 'USER_OVERRIDDEN';

/** The receipt fields the invariants read. */
export interface ReceiptFacts {
  readonly grade: string;
  readonly state: State;
  readonly claimId?: string | undefined;
  readonly attribution?: 'likely' | undefined;
  readonly override?: { readonly previousState: Exclude<State, 'USER_OVERRIDDEN'> } | undefined;
  readonly supersededBy?: string | undefined;
  readonly finalAt?: string | undefined;
}

/** `override` iff USER_OVERRIDDEN; `finalAt` iff the state before any override is FINAL (§3, §8). */
function stateProblems(receipt: ReceiptFacts): Problem[] {
  const problems: Problem[] = [];
  const overridden = receipt.state === 'USER_OVERRIDDEN';
  if (overridden && receipt.override === undefined) {
    problems.push(['override', 'required when state is USER_OVERRIDDEN']);
  }
  if (!overridden && receipt.override !== undefined) {
    problems.push(['override', 'allowed only when state is USER_OVERRIDDEN']);
  }
  const underlying = overridden ? receipt.override?.previousState : receipt.state;
  if (underlying === 'FINAL' && receipt.finalAt === undefined) {
    problems.push(['finalAt', 'required once the receipt is FINAL']);
  }
  if (underlying === 'PENDING' && receipt.finalAt !== undefined) {
    problems.push(['finalAt', 'a PENDING receipt has no finalAt']);
  }
  return problems;
}

/** grade UNASKED ⇔ attribution 'likely' and no claim; only UNASKED receipts are superseded (§2, §7, §8). */
function unaskedProblems(receipt: ReceiptFacts): Problem[] {
  const problems: Problem[] = [];
  if (receipt.grade === 'UNASKED') {
    if (receipt.attribution === undefined) problems.push(['attribution', "an UNASKED receipt says 'likely'"]);
    if (receipt.claimId !== undefined) problems.push(['claimId', 'an UNASKED receipt has no claim']);
    return problems;
  }
  if (receipt.attribution !== undefined) problems.push(['attribution', 'allowed only on an UNASKED receipt']);
  if (receipt.supersededBy !== undefined) {
    problems.push(['supersededBy', 'only an UNASKED receipt can be superseded']);
  }
  return problems;
}

export function receiptProblems(receipt: ReceiptFacts): Problem[] {
  return [...stateProblems(receipt), ...unaskedProblems(receipt)];
}

/** An observer's window is a real interval, and `allCalendars` is a calendar fact only (§3). */
export function coverageProblems(entry: {
  readonly source: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly allCalendars?: boolean | undefined;
}): Problem[] {
  const problems: Problem[] = [];
  if (instantMs(entry.windowEnd) < instantMs(entry.windowStart)) {
    problems.push(['windowEnd', 'must not be before windowStart']);
  }
  if (entry.allCalendars !== undefined && entry.source !== 'gcal.event') {
    problems.push(['allCalendars', 'applies to gcal.event only']);
  }
  return problems;
}

/** Fired signals are distinct, and at least one is agent-specific: userIdle alone attributes nothing (§7). */
export function attributionProblems(attribution: { readonly signals: readonly string[] }): Problem[] {
  const { signals } = attribution;
  const problems: Problem[] = [];
  if (new Set(signals).size !== signals.length) problems.push(['signals', 'each signal at most once']);
  if (signals.every((signal) => signal === 'userIdle')) {
    problems.push(['signals', 'needs an agent-specific signal']);
  }
  return problems;
}

/** An idle interval is a real interval. */
export function intervalProblems(interval: { readonly from: string; readonly to: string }): Problem[] {
  return instantMs(interval.to) < instantMs(interval.from) ? [['to', 'must not be before from']] : [];
}

/** The UTC offset written at the end of `isoTs`, in ms (`Z` is 0). Call only once `instantMs` is not NaN. */
function writtenOffsetMs(isoTs: string): number {
  const groups = OFFSET_PARTS.exec(isoTs)?.groups;
  if (groups?.sign === undefined) return 0;
  const minutes = Number(groups.hours) * MINUTES_PER_HOUR + Number(groups.minutes);
  return (groups.sign === '-' ? -minutes : minutes) * MS_PER_MINUTE;
}

/** `start(day, t)` (§4.1): the start of the day containing `t`, in `t`'s own written offset; NaN for NaN. */
function dayStartMs(isoTs: string): number {
  const offsetMs = writtenOffsetMs(isoTs);
  const local = instantMs(isoTs) + offsetMs;
  return local - (((local % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) - offsetMs;
}

/**
 * The longest local day (§4.1): 25 h, the day a DST change repeats an hour. `claimedAtEnd` may reach no
 * further than `start(day, t) + 25 h`, so an adapter's next local midnight always fits and nothing longer does.
 */
const LONGEST_DAY_MS = MS_PER_DAY + MS_PER_HOUR;

/**
 * `claimedAtEnd` (§4.1) is only for `day` precision (an adapter's DST-safe next local midnight) and lies in
 * `(claimedAt, start(day, t) + 25 h]`: strictly after `claimedAt`, and no later than the longest local day.
 */
export function claimProblems(claim: {
  readonly claimedAt: string;
  readonly claimedAtPrecision: string;
  readonly claimedAtEnd?: string | undefined;
}): Problem[] {
  if (claim.claimedAtEnd === undefined) return [];
  if (claim.claimedAtPrecision !== 'day') return [['claimedAtEnd', 'allowed only with day precision']];
  const start = instantMs(claim.claimedAt);
  const end = instantMs(claim.claimedAtEnd);
  // NaN: a field that is not an IsoTs, already reported at its own path; there is nothing to compare.
  if (Number.isNaN(start) || Number.isNaN(end)) return [];
  if (end <= start) return [['claimedAtEnd', 'must be after claimedAt']];
  if (end > dayStartMs(claim.claimedAt) + LONGEST_DAY_MS) {
    return [['claimedAtEnd', 'must be at most 25 h after the start of the claimedAt day']];
  }
  return [];
}

/**
 * §10: an observation's id is `idFromHash(contentHash)`, so one content has exactly one id and no row can choose
 * its own. Checked only once `contentHash` is a valid hash (a bad one is already reported at its own path).
 */
export function observationProblems(observation: {
  readonly id: string;
  readonly contentHash: string;
}): Problem[] {
  const { id, contentHash } = observation;
  if (typeof contentHash !== 'string' || !SHA256_HEX.test(contentHash)) return [];
  return id === idFromHash(contentHash) ? [] : [['id', 'must be idFromHash(contentHash)']];
}

// ── Receipt signals (§5.1, §8) ──────────────────────────────────────────────────────────────────

/** The §5.1 match features, in table order: the only feature names a policy weighs or a receipt displays. */
export const MATCH_FEATURES = [
  'timeProximity',
  'counterpartyExact',
  'counterpartyDomain',
  'counterpartyName',
  'subjectOverlap',
  'amountExact',
  'merchantMatch',
  'modelScore',
] as const;

/** §8: receipt `signals` keys are the §5.1 feature names plus `score`, nothing else (Hard Rules 2, 10). */
export const RECEIPT_SIGNALS = [...MATCH_FEATURES, 'score'] as const;

const SIGNAL_KEYS: ReadonlySet<string> = new Set(RECEIPT_SIGNALS);

/** Every key of a receipt's `signals` that is not a §5.1 feature name or `score`, at its own path. */
export function signalProblems(signals: Readonly<Record<string, unknown>>): Problem[] {
  return Object.keys(signals)
    .filter((key) => !SIGNAL_KEYS.has(key))
    .map((key): Problem => [key, 'not a §5.1 feature name or score']);
}

// ── Reasons (§15) ───────────────────────────────────────────────────────────────────────────────

/** The closed ReasonCode vocabulary, in docs/grading.md §15 table order (reasons are emitted in this order). */
export const REASON_CODES = [
  'match.best',
  'match.none',
  'cp.plus_tag',
  'cp.confusable',
  'cp.non_ascii',
  'claim.too_vague',
  'claim.no_target',
  'coverage.none',
  'coverage.partial',
  'coverage.account_unbound',
  'coverage.calendars_hidden',
  'coverage.multiple_accounts',
  'coverage.no_account',
  'coverage.no_parser',
  'coverage.never_completed',
  'grace.waiting',
  'scope.type_not_allowed',
  'scope.counterparty_not_allowed',
  'allowlist.unchecked',
  'ceiling.exceeded',
  'ceiling.cumulative_exceeded',
  'ceiling.currency_mismatch',
  'scope.observed_not_declared',
  'unasked.session',
  'unasked.idle',
  'unasked.signature',
  'unasked.adjacent',
  'override.user',
  'superseded',
] as const;

/**
 * What one reason param holds; schema.ts gives each kind its schema. Every kind is an id, a hash, an enum
 * value or an integer, so no param can carry an address, a name, a subject or a formatted local time.
 * `source?` may be omitted (a type with no sources has none to name); every other param is required.
 */
export type ReasonParamKind =
  | 'ulid'
  | 'sha256'
  | 'source?'
  | 'actionType'
  | 'agent'
  | 'overrideGrade'
  | 'cents'
  | 'priorSpend'
  | 'currency';

type ParamKinds = Readonly<Record<string, ReasonParamKind>>;

const NO_PARAMS = {} as const;
const SOURCE = { source: 'source?' } as const;
const AGENT = { agent: 'agent' } as const;

/** §15 "Params per code (closed)": exactly these params, by name and kind; a code listed with none takes `{}`. */
export const REASON_PARAM_KINDS: Readonly<Record<(typeof REASON_CODES)[number], ParamKinds>> = Object.freeze({
  'match.best': { observationId: 'ulid' },
  'match.none': NO_PARAMS,
  'cp.plus_tag': NO_PARAMS,
  'cp.confusable': NO_PARAMS,
  'cp.non_ascii': NO_PARAMS,
  'claim.too_vague': NO_PARAMS,
  'claim.no_target': NO_PARAMS,
  'coverage.none': SOURCE,
  'coverage.partial': SOURCE,
  'coverage.account_unbound': SOURCE,
  'coverage.calendars_hidden': SOURCE,
  'coverage.multiple_accounts': SOURCE,
  'coverage.no_account': SOURCE,
  'coverage.no_parser': SOURCE,
  'coverage.never_completed': NO_PARAMS,
  'grace.waiting': SOURCE,
  'scope.type_not_allowed': { type: 'actionType' },
  'scope.counterparty_not_allowed': NO_PARAMS,
  'allowlist.unchecked': NO_PARAMS,
  'ceiling.exceeded': { amountCents: 'cents', ceilingCents: 'cents' },
  'ceiling.cumulative_exceeded': {
    priorSpendCents: 'priorSpend',
    amountCents: 'cents',
    ceilingCents: 'cents',
  },
  'ceiling.currency_mismatch': { currency: 'currency', spendCurrency: 'currency' },
  'scope.observed_not_declared': { scopeHash: 'sha256' },
  'unasked.session': AGENT,
  'unasked.idle': AGENT,
  'unasked.signature': AGENT,
  'unasked.adjacent': AGENT,
  'override.user': { grade: 'overrideGrade' },
  superseded: { claimId: 'ulid' },
});

/**
 * A Zod `superRefine` callback that checks a reason's params against its code's own schema (`paramsOf`) and
 * reports each problem at `params.<name>`: a missing param, a bad value, or a param the code does not have.
 * Zod runs it only once `code` is a known ReasonCode and `params` is a record of strings and numbers.
 */
export function refineReasonParams<T extends { readonly code: string; readonly params: unknown }>(
  paramsOf: (code: T['code']) => z.ZodType | undefined,
): (reason: T, ctx: z.RefinementCtx<T>) => void {
  return (reason, ctx) => {
    const result = paramsOf(reason.code)?.safeParse(reason.params);
    for (const issue of result?.error?.issues ?? []) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) {
          ctx.addIssue({ code: 'custom', path: ['params', key], message: `not a param of ${reason.code}` });
        }
      } else {
        ctx.addIssue({ code: 'custom', path: ['params', ...issue.path], message: issue.message });
      }
    }
  };
}
