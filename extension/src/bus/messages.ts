/**
 * Every message that crosses a context boundary (content script ↔ service worker ↔ UI page).
 *
 * One Zod discriminated union on `type`; every member is a strict object, so a sender cannot smuggle
 * a field the schema does not name (Hard Rule 2). Payload items reuse the ledger schemas, so the bus
 * and the ledger agree on what a Claim or an Observation is. `send()` validates before sending and
 * `listen()` validates on receive: parse at every boundary.
 *
 * Chrome serialises runtime messages as JSON. Every value here must survive that: no `undefined`
 * inside arrays, no Dates, no Maps.
 */
import { z } from 'zod';

import { AdapterHealth, Claim, CoveragePing, IsoTs, Observation, Request } from '../ledger/types';

/** The eight ledger tables (build_spec §6, sprint 0.6). `ledger.changed` names which ones moved. */
export const LedgerTable = z.enum([
  'requests',
  'claims',
  'observations',
  'grants',
  'receipts',
  'adapterHealth',
  'coverage',
  'meta',
]);

export const BusMessageType = z.enum([
  'adapter.health',
  'adapter.claims',
  'observer.observations',
  'coverage.ping',
  'ui.query',
  'ui.result',
  'ledger.changed',
]);

/**
 * The seven type strings. A frozen copy: Zod's `.options` is a mutable array shared with the schema,
 * so exporting it directly would let one consumer's `.sort()` or `.push()` rewrite the list for all.
 */
export const BUS_MESSAGE_TYPES: readonly BusMessageType[] = Object.freeze([...BusMessageType.options]);

/** A content script's adapter ran `health()` (Hard Rule 6: DEGRADED is reported, never hidden). */
export const AdapterHealthMessage = z.strictObject({
  type: z.literal('adapter.health'),
  health: AdapterHealth,
});

/** What an agent adapter extracted from one page read. */
export const AdapterClaimsMessage = z.strictObject({
  type: z.literal('adapter.claims'),
  adapterId: z.string().min(1),
  version: z.string().min(1),
  requests: z.array(Request),
  claims: z.array(Claim),
});

/** What a Gmail/Calendar observer extracted from one page read (derived facts only). */
export const ObserverObservationsMessage = z.strictObject({
  type: z.literal('observer.observations'),
  observerId: z.string().min(1),
  version: z.string().min(1),
  observations: z.array(Observation),
});

/** What an observer could see, and when (Hard Rule 5). */
export const CoveragePingMessage = z.strictObject({
  type: z.literal('coverage.ping'),
  ping: CoveragePing,
});

/** Questions a UI page asks the service worker. Sprint 4 adds more kinds. */
export const UiQuery = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ledger.export') }),
  z.strictObject({ kind: z.literal('health.list') }),
]);

export const UiQueryKind = z.enum(['ledger.export', 'health.list']);

export const UiQueryMessage = z.strictObject({
  type: z.literal('ui.query'),
  query: UiQuery,
});

export const UiResultError = z.enum(['unknown_query', 'handler_failed', 'unavailable']);

/**
 * The answer to a `ui.query`, delivered as the response to that query.
 *
 * `data` is `unknown` on purpose: the bus only guarantees the envelope. The UI re-parses `data` with
 * the schema exported by the module that answers that `kind` (e.g. the ledger's export schema for
 * `ledger.export`), so each payload has exactly one owner. `data` must be JSON-serialisable; use
 * `null`, never `undefined`.
 */
export const UiResultMessage = z.discriminatedUnion('ok', [
  z.strictObject({
    type: z.literal('ui.result'),
    kind: UiQueryKind,
    ok: z.literal(true),
    // `undefined` would vanish on the JSON wire and the UI would see a malformed result; refuse it
    // here so the answering side fails loudly instead.
    data: z.unknown().refine((value): boolean => value !== undefined, 'data must be JSON; use null'),
  }),
  z.strictObject({
    type: z.literal('ui.result'),
    kind: UiQueryKind,
    ok: z.literal(false),
    error: UiResultError,
  }),
]);

/** The service worker wrote to the ledger; open UI pages re-query the tables they show. */
export const LedgerChangedMessage = z.strictObject({
  type: z.literal('ledger.changed'),
  tables: z.array(LedgerTable).min(1),
  at: IsoTs,
});

export const BusMessage = z.discriminatedUnion('type', [
  AdapterHealthMessage,
  AdapterClaimsMessage,
  ObserverObservationsMessage,
  CoveragePingMessage,
  UiQueryMessage,
  UiResultMessage,
  LedgerChangedMessage,
]);

export type LedgerTable = z.infer<typeof LedgerTable>;
export type BusMessageType = z.infer<typeof BusMessageType>;
export type AdapterHealthMessage = z.infer<typeof AdapterHealthMessage>;
export type AdapterClaimsMessage = z.infer<typeof AdapterClaimsMessage>;
export type ObserverObservationsMessage = z.infer<typeof ObserverObservationsMessage>;
export type CoveragePingMessage = z.infer<typeof CoveragePingMessage>;
export type UiQuery = z.infer<typeof UiQuery>;
export type UiQueryKind = z.infer<typeof UiQueryKind>;
export type UiQueryMessage = z.infer<typeof UiQueryMessage>;
export type UiResultError = z.infer<typeof UiResultError>;
export type UiResult = z.infer<typeof UiResultMessage>;
export type LedgerChangedMessage = z.infer<typeof LedgerChangedMessage>;
export type BusMessage = z.infer<typeof BusMessage>;

/** The member of the union with a given `type` (both `ui.result` shapes for `'ui.result'`). */
export type BusMessageOf<T extends BusMessageType> = Extract<BusMessage, { type: T }>;

export function isBusMessageType(value: unknown): value is BusMessageType {
  return BusMessageType.safeParse(value).success;
}

/** The failed answer to a query of `kind`. */
export function uiFailure(kind: UiQueryKind, error: UiResultError): UiResult {
  return { type: 'ui.result', kind, ok: false, error };
}
