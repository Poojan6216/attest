/**
 * The golden scenario format's reason codes and their params (docs/grading.md §15), moved out of ./scenario-schema.ts
 * in the Sprint 5 close to keep that file within its size limit; it re-exports them. Written from the contract, not
 * imported from src/core (./scenario-schema.ts's header).
 */
import { z } from 'zod';

/** §15 ReasonCode table, in table order (the order receipts list codes within a group). */
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
  'coverage.changes_unfollowed',
  'coverage.change_unprovable',
  'coverage.clock_repaired',
  'coverage.list_unsettled',
  'coverage.account_partial',
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

export const ReasonCode = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCode>;

/**
 * What one reason param holds (§15 "Params per code (closed)"). Ids are written in scenario files as refs
 * (`o1`, `c1`) and resolved by the loader; a `scopeHash` is written as the observed scope itself and the
 * loader stores `sha256Hex(scope)` (§15 v1.3), so no hash is typed by hand; everything else is written as the
 * value itself.
 */
export type ParamKind =
  | 'observationRef'
  | 'claimRef'
  | 'source'
  | 'actionType'
  | 'cents'
  | 'currency'
  | 'scopeHash'
  | 'agent'
  | 'grade';

const NO_PARAMS = {} as const;
const SOURCE = { source: 'source' } as const;
const AGENT = { agent: 'agent' } as const;

/** §15 (v1.4) params per code, written from the contract. `source` is omitted for a type with no sources. */
export const REASON_PARAMS: Readonly<Record<ReasonCode, Readonly<Record<string, ParamKind>>>> = {
  'match.best': { observationId: 'observationRef' },
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
  'coverage.changes_unfollowed': SOURCE,
  'coverage.change_unprovable': SOURCE,
  'coverage.clock_repaired': SOURCE,
  'coverage.list_unsettled': SOURCE,
  'coverage.account_partial': SOURCE,
  'coverage.multiple_accounts': SOURCE,
  'coverage.no_account': SOURCE,
  // §15 v1.4: coverage.no_parser carries {source} like the other coverage caps.
  'coverage.no_parser': SOURCE,
  'coverage.never_completed': NO_PARAMS,
  'grace.waiting': SOURCE,
  'scope.type_not_allowed': { type: 'actionType' },
  'scope.counterparty_not_allowed': NO_PARAMS,
  'allowlist.unchecked': NO_PARAMS,
  'ceiling.exceeded': { amountCents: 'cents', ceilingCents: 'cents' },
  'ceiling.cumulative_exceeded': { priorSpendCents: 'cents', amountCents: 'cents', ceilingCents: 'cents' },
  'ceiling.currency_mismatch': { currency: 'currency', spendCurrency: 'currency' },
  'scope.observed_not_declared': { scopeHash: 'scopeHash' },
  'unasked.session': AGENT,
  'unasked.idle': AGENT,
  'unasked.signature': AGENT,
  'unasked.adjacent': AGENT,
  'override.user': { grade: 'grade' },
  superseded: { claimId: 'claimRef' },
};

/** A param value as written in a scenario file: a ref, an enum value, a code, a hash, or an integer. */
const ParamValue = z.union([z.string().min(1).max(64), z.number().int().min(0)]);
const ParamName = z.string().regex(/^[a-z][A-Za-z]*$/, 'param names are camelCase identifiers');
export const ReasonParamsByCode = z.partialRecord(ReasonCode, z.record(ParamName, ParamValue));
export type ReasonParamsByCode = z.infer<typeof ReasonParamsByCode>;
