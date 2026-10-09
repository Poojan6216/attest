/**
 * Reason text (docs/grading.md §6.4, §15; Hard Rule 7; sprint task 1.7 Done-when).
 *
 * Receipts store reasons as `{code, params}` and never words, so they stay identical across time zones and
 * locales and carry no PII; the UI renders the words (Sprint 4). `reasonText(reason)` is that rendering: one
 * short English sentence per ReasonCode, built only from the reason's own params. Ids and hashes are written
 * verbatim; amounts are integer minor units written as plain digits (no locale formatting, and no currency is
 * guessed for them); agents, sources, action types and grades use the fixed labels below. Deterministic: the
 * same reason always gives the same text.
 *
 * Hard Rule 7: Attest cannot prove who acted. Every `unasked.*` text says "likely", and no text states as fact
 * that an agent did something (tests/unit/core/reason-text.spec.ts checks every text for banned phrasings).
 *
 * PURE: no I/O, no clock, no `Intl`, no locale (Hard Rule 4).
 */
import { z } from 'zod';

import {
  ActionType,
  AgentId,
  Currency,
  Grade,
  ObservationSource,
  ReasonCode,
  ReasonParams,
  Sha256,
  Ulid,
} from './schema';

/** How each agent is named in text. */
export const AGENT_LABEL: Readonly<Record<AgentId, string>> = Object.freeze({
  muse: 'Muse',
  chatgpt: 'ChatGPT',
  dots: 'Dots',
  claude: 'Claude',
});

/** What Attest reads for each observation source. */
const SOURCE_LABEL: Readonly<Record<ObservationSource, string>> = Object.freeze({
  'gmail.sent': 'Gmail Sent mail',
  'gmail.receipt': 'Gmail receipts',
  'gcal.event': 'Google Calendar',
});

/** The service whose account an observer reads, for the account reasons. */
const ACCOUNT_LABEL: Readonly<Record<ObservationSource, string>> = Object.freeze({
  'gmail.sent': 'Gmail',
  'gmail.receipt': 'Gmail',
  'gcal.event': 'Google Calendar',
});

/** Each action type as something an agent may be allowed to do. */
const ACTION_LABEL: Readonly<Record<ActionType, string>> = Object.freeze({
  'email.sent': 'sending email',
  'calendar.created': 'creating calendar events',
  'calendar.updated': 'changing calendar events',
  'calendar.deleted': 'deleting calendar events',
  'purchase.made': 'making purchases',
  'subscription.changed': 'changing subscriptions',
  'listing.posted': 'posting listings',
  'message.sent': 'sending messages',
  other: 'other actions',
});

/** The grade names the UI shows. */
const GRADE_LABEL: Readonly<Record<Grade, string>> = Object.freeze({
  VERIFIED: 'VERIFIED',
  PARTIAL: 'PARTIAL',
  NOT_FOUND: 'NOT FOUND',
  UNASKED: 'UNASKED',
  OVER_SCOPE: 'OVER SCOPE',
  UNVERIFIABLE: 'UNVERIFIABLE',
});

export type ReasonTextErrorCode =
  /** The code is not a ReasonCode (only an unparsed reason can carry one). */
  | 'unknown_code'
  /** A param the code needs is missing or malformed (§15). */
  | 'invalid_params';

/**
 * What a `ReasonTextError` may name besides its code: the validated ReasonCode, and for `invalid_params` the param
 * (one of that code's own §15 param names). Never text from the reason itself.
 */
export type ReasonTextDetail = ReasonCode | `${ReasonCode}.${string}`;

/**
 * A reason that does not fit the closed vocabulary (§15): never rendered as a guess (Hard Rule 6). The message
 * carries the code and, when there is one, a detail built from the closed vocabulary only (`ReasonTextDetail`): an
 * unknown code is not repeated, since an unparsed reason's code may hold any text (Hard Rule 10).
 */
export class ReasonTextError extends Error {
  constructor(
    readonly code: ReasonTextErrorCode,
    readonly detail?: ReasonTextDetail,
  ) {
    super(detail === undefined ? `reason text ${code}` : `reason text ${code}: ${detail}`);
    this.name = 'ReasonTextError';
  }
}

/**
 * What `reasonText` accepts: a parsed `Reason`, or anything shaped like one (a stored row read back, a
 * reason from an imported ledger). Every param is checked against its §15 schema before it is used.
 */
export interface ReasonLike {
  readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;
}

type Params = ReasonLike['params'];

/** One reason's params (already checked against `ReasonParams`), each read with its own typed schema. */
class Read {
  constructor(
    private readonly params: Params,
    private readonly code: ReasonCode,
  ) {}

  private value<Schema extends z.ZodType>(name: string, schema: Schema): z.output<Schema> {
    const result = schema.safeParse(this.params[name]);
    if (!result.success) throw new ReasonTextError('invalid_params', `${this.code}.${name}`);
    return result.data;
  }

  agent(): string {
    return AGENT_LABEL[this.value('agent', AgentId)];
  }

  /** The source's label, or undefined for a type with no sources (§15: `source` is then omitted). */
  source(labels: Readonly<Record<ObservationSource, string>>): string | undefined {
    const source = this.value('source', ObservationSource.optional());
    return source === undefined ? undefined : labels[source];
  }

  /** A whole number of minor currency units, as plain digits. */
  units(name: string): string {
    return String(this.value(name, z.number().int().min(0)));
  }

  ulid(name: string): string {
    return this.value(name, Ulid);
  }

  sha256(name: string): string {
    return this.value(name, Sha256);
  }

  currency(name: string): string {
    return this.value(name, Currency);
  }

  type(): ActionType {
    return this.value('type', ActionType);
  }

  grade(): string {
    return GRADE_LABEL[this.value('grade', Grade)];
  }
}

type Render = (read: Read) => string;

/** A sentence that names the source when the reason has one, and the generic form when it has none. */
const bySource =
  (named: (source: string) => string, unnamed: string, labels = SOURCE_LABEL): Render =>
  (read) => {
    const source = read.source(labels);
    return source === undefined ? unnamed : named(source);
  };

/** Every `unasked.*` sentence: hedged with "likely" before any evidence is named (Hard Rule 7). */
const likely =
  (evidence: (agent: string) => string): Render =>
  (read) => {
    const agent = read.agent();
    return `This was likely ${agent}: ${evidence(agent)}.`;
  };

const TEXT: Readonly<Record<ReasonCode, Render>> = Object.freeze({
  'match.best': (read) => `The closest evidence Attest found is observation ${read.ulid('observationId')}.`,
  'match.none': () => "Attest found no evidence in this claim's time window to compare it with.",
  'cp.plus_tag': () => 'The address differs from the claimed one by a +tag, so it is not the same address.',
  'cp.confusable': () =>
    'The address uses look-alike characters, so it is not treated as the claimed address.',
  'cp.non_ascii': () =>
    'The addresses match exactly but use non-ASCII characters, which can hide look-alikes.',
  'claim.too_vague': () =>
    'The claim does not say who, what or how much, so it cannot be matched to evidence.',
  'claim.no_target': () =>
    'The calendar claim does not say when the event starts, so there is nothing to check.',
  'coverage.none': bySource(
    (source) => `Attest did not see ${source} during this claim's time window.`,
    'No source Attest reads can show this kind of action.',
  ),
  'coverage.partial': bySource(
    (source) => `Attest saw ${source} for only part of this claim's time window.`,
    "Attest saw only part of this claim's time window.",
  ),
  'coverage.account_unbound': bySource(
    (service) => `No ${service} account is set for this agent, so Attest may have checked a different one.`,
    'No account is set for this agent, so Attest may have checked a different one.',
    ACCOUNT_LABEL,
  ),
  'coverage.calendars_hidden': bySource(
    (source) => `Not every calendar was visible when Attest read ${source}.`,
    'Not every calendar was visible when Attest checked.',
  ),
  'coverage.changes_unfollowed': bySource(
    (source) =>
      `Attest was not following changes in ${source} for the whole time this change could have happened.`,
    'Attest was not following changes for the whole time this change could have happened.',
  ),
  'coverage.list_unsettled': bySource(
    (source) =>
      `Attest last looked at ${source} too soon after this claim for a message sent from elsewhere to show there.`,
    'Attest last looked too soon after this claim for a message sent from elsewhere to show there.',
  ),
  'coverage.change_unprovable': bySource(
    (source) =>
      `Attest reads ${source} as snapshots, so it can see a change that was made but cannot show one never was.`,
    'Attest reads snapshots, so it can see a change that was made but cannot show one never was.',
  ),
  'coverage.clock_repaired': bySource(
    (source) =>
      `The clock was set back after running ahead, so ${source} cannot show the event came after the claim.`,
    'The clock was set back after running ahead, so Attest cannot show the event came after the claim.',
  ),
  'coverage.account_partial': bySource(
    (service) =>
      `Attest did not see this claim's whole time window in every ${service} account set for this agent.`,
    "Attest did not see this claim's whole time window in every account set for this agent.",
    ACCOUNT_LABEL,
  ),
  'coverage.multiple_accounts': bySource(
    (service) => `Attest saw more than one ${service} account, and none is set for this agent.`,
    'Attest saw more than one account, and none is set for this agent.',
    ACCOUNT_LABEL,
  ),
  'coverage.no_account': bySource(
    (service) => `Attest could not tell which ${service} account it was reading.`,
    'Attest could not tell which account it was reading.',
    ACCOUNT_LABEL,
  ),
  'coverage.no_parser': () => 'Attest cannot read receipts from this merchant yet.',
  'coverage.never_completed': () =>
    'Attest never saw the whole time window, so this claim could not be checked.',
  'grace.waiting': bySource(
    (source) => `Still checking: waiting to see ${source} for the whole time window.`,
    'Still checking: waiting to see the whole time window.',
  ),
  'scope.type_not_allowed': (read) => {
    const type = read.type();
    return `This claim is for ${ACTION_LABEL[type]} (${type}), which you did not allow this agent.`;
  },
  'scope.counterparty_not_allowed': () =>
    'The recipient is not on the list of addresses and domains you allowed this agent.',
  'allowlist.unchecked': () => 'Your allowlist could not be checked, because the claim names no address.',
  'ceiling.exceeded': (read) => {
    const amount = read.units('amountCents');
    return `The amount, ${amount}, is above the spend ceiling of ${read.units('ceilingCents')} (minor units).`;
  },
  'ceiling.cumulative_exceeded': (read) => {
    const [prior, amount, ceiling] = [
      read.units('priorSpendCents'),
      read.units('amountCents'),
      read.units('ceilingCents'),
    ];
    return `With ${prior} claimed earlier in the spend window, ${amount} more goes over the spend ceiling of ${ceiling} (minor units).`;
  },
  'ceiling.currency_mismatch': (read) => {
    const [currency, ceiling] = [read.currency('currency'), read.currency('spendCurrency')];
    return `The amount is in ${currency} but the spend ceiling is in ${ceiling}, so they cannot be compared.`;
  },
  'scope.observed_not_declared': (read) =>
    `This agent holds a permission you did not declare (scope hash ${read.sha256('scopeHash')}).`,
  'unasked.session': likely((agent) => `a ${agent} session was active within minutes of it`),
  'unasked.idle': likely(() => 'Attest saw no input from you in the minutes before it'),
  'unasked.signature': likely((agent) => `its subject contains a known ${agent} signature`),
  'unasked.adjacent': likely(
    (agent) => `the ${agent} activity log has an unclaimed entry within minutes of it`,
  ),
  'override.user': (read) => `You marked this receipt ${read.grade()}.`,
  superseded: (read) =>
    `A later claim (${read.ulid('claimId')}) explains this action, so it no longer counts as unasked.`,
});

/**
 * One short English sentence for `reason`, from its code and params only (§6.4: the UI renders the words).
 * Throws `ReasonTextError('unknown_code')` for a code outside the closed vocabulary and
 * `ReasonTextError('invalid_params')` when its params are not exactly the code's §15 params (missing,
 * malformed or extra); a reason parsed with the `Reason` schema has neither problem.
 */
export function reasonText(reason: ReasonLike): string {
  const code = ReasonCode.safeParse(reason.code);
  if (!code.success) throw new ReasonTextError('unknown_code');
  // The code's whole params object, exactly as the Reason schema checks it (strict: no extra param).
  if (ReasonParams.get(code.data)?.safeParse(reason.params).success !== true) {
    throw new ReasonTextError('invalid_params', code.data);
  }
  return TEXT[code.data](new Read(reason.params, code.data));
}
