/**
 * Every message that crosses a context boundary (content script ↔ service worker ↔ UI page).
 *
 * One Zod discriminated union on `type`; every member is a strict object, so a sender cannot smuggle
 * a field the schema does not name (Hard Rule 2). Adapter and observer ids and versions are `ComponentId`
 * tokens, never text (OBS-1). Payload items are the canonical core schemas (src/core/schema.ts), so the bus,
 * the ledger and grading agree on what a Claim or an Observation is; the coverage ping is the ledger's
 * (src/ledger/types.ts) and a Calendar snapshot the Calendar observer's (src/observers/gcal/snapshot.ts), parsed with
 * that one schema on both ends. `send()` validates before sending and `listen()` validates on receive: parse at
 * every boundary.
 *
 * Observer messages are acknowledged (sprint_2 2.7 interface 6): the service worker answers `adapter.health`,
 * `observer.observations`, `coverage.ping` and `calendar.snapshot` with a `BusAck`, `{ ok: true }` once it has
 * stored what the message carries, or `{ ok: false, code }` (a closed `AckCode`) when it refused any of it. An
 * observer sends its next message only after that answer (src/observers/base.ts), so a pass whose rows were refused
 * never posts the coverage that would claim its window (Hard Rule 5).
 *
 * The schema cannot know which fields each observer source may store, or whether a contentHash is the hash of
 * its row: that needs the policy. The ledger writer checks both (`upsertObservation` runs
 * `observationIntegrityProblems`) before anything reaches disk, so a received observation is stored only
 * through it (SEC-V1, Hard Rule 2).
 *
 * Chrome serialises runtime messages as JSON. Every value here must survive that: no `undefined`
 * inside arrays, no Dates, no Maps.
 */
import { z } from 'zod';

import { importExtractorId } from '../config';

import {
  Claim,
  ComponentId,
  HealthReport,
  IsoTs,
  Observation,
  AgentId,
  Request,
  SCHEMA_LIMITS,
  Sha256,
} from '../core/schema';
import { oneLineText } from '../core/schema-text';
import { CoveragePing } from '../ledger/types';
import { CalendarSnapshot } from '../observers/gcal/snapshot';
import {
  FlagSetMessage,
  GrantSaveMessage,
  GrantSaveResult,
  LedgerWipeMessage,
  ReaderToggleMessage,
  ReceiptEventMessage,
  ReceiptEventResult,
  RetentionSaveMessage,
  SettingResult,
} from './page-commands';

export * from './page-commands';

/**
 * The ledger tables (build_spec §6, sprint 0.6; the coverage intervals of 2.6 and the Calendar snapshots of 2.7).
 * `ledger.changed` names which ones moved. src/ledger/index-fields.ts LEDGER_TABLE_NAMES is the same list.
 */
export const LedgerTable = z.enum([
  'requests',
  'claims',
  'observations',
  'grants',
  'receipts',
  'adapterHealth',
  'coverage',
  'meta',
  'coverageIntervals',
  'calendarSnapshots',
  'activity',
  'alerts',
  'digests',
]);

export const BusMessageType = z.enum([
  'adapter.health',
  'adapter.claims',
  'adapter.scope',
  'observer.observations',
  'coverage.ping',
  'calendar.snapshot',
  'ui.query',
  'ui.result',
  'ledger.changed',
  'claims.import',
  'receipt.event',
  'grant.save',
  'retention.save',
  'reader.toggle',
  'flag.set',
  'ledger.wipe',
]);

/**
 * The type strings. A frozen copy: Zod's `.options` is a mutable array shared with the schema,
 * so exporting it directly would let one consumer's `.sort()` or `.push()` rewrite the list for all.
 */
export const BUS_MESSAGE_TYPES: readonly BusMessageType[] = Object.freeze([...BusMessageType.options]);

/** A content script's adapter ran `health()` (Hard Rule 6: DEGRADED is reported, never hidden). */
export const AdapterHealthMessage = z.strictObject({
  type: z.literal('adapter.health'),
  health: HealthReport,
});

/** What an agent adapter extracted from one page read. */
export const AdapterClaimsMessage = z.strictObject({
  type: z.literal('adapter.claims'),
  adapterId: ComponentId,
  version: ComponentId,
  requests: z.array(Request).max(SCHEMA_LIMITS.BATCH),
  claims: z.array(Claim).max(SCHEMA_LIMITS.BATCH),
});

/**
 * What an agent's settings page lists (connected apps, permissions), as one adapter pass read it (sprint_3 3.0): the
 * scopes as the page names them, one line each, the items `Grant.observedScopes` holds (3.7 sets it from these).
 */
export const ScopeSnapshot = z.strictObject({
  agent: AgentId,
  scopes: z.array(oneLineText(SCHEMA_LIMITS.ITEM)).max(SCHEMA_LIMITS.LIST),
  observedAt: IsoTs,
});

/** What an agent's settings page lists, as one adapter pass read it (sprint_3 3.0; 3.7 diffs it with the grant). */
export const AdapterScopeMessage = z.strictObject({
  type: z.literal('adapter.scope'),
  adapterId: ComponentId,
  version: ComponentId,
  snapshot: ScopeSnapshot,
});

/** What a Gmail/Calendar observer extracted from one page read (derived facts only). */
export const ObserverObservationsMessage = z.strictObject({
  type: z.literal('observer.observations'),
  observerId: ComponentId,
  version: ComponentId,
  observations: z.array(Observation).max(SCHEMA_LIMITS.BATCH),
});

/** What an observer could see, and when (Hard Rule 5): one message per window a clean pass saw. */
export const CoveragePingMessage = z.strictObject({
  type: z.literal('coverage.ping'),
  ping: CoveragePing,
});

/**
 * The Calendar observer's snapshot of the range one clean pass read, posted after that pass's observations and
 * coverage, only when the page's account is known (sprint_2 2.7 interface 5). The service worker keeps it as the
 * range's previous snapshot and derives the Calendar rows from it (src/background/calendar-pass.ts).
 * `accountHash` (the hash of the page's account as that same pass read it, never the address) is added by the
 * Calendar content script (entrypoints/content/gcal.content.ts): the store is keyed by account, and a pass may have
 * no coverage ping to name it (a month whose every day hides events). Without it the snapshot is skipped.
 */
export const CalendarSnapshotMessage = z.strictObject({
  type: z.literal('calendar.snapshot'),
  observerId: ComponentId,
  snapshot: CalendarSnapshot,
  accountHash: Sha256.optional(),
});

/**
 * Why the service worker refused (part of) an observer message. Codes, never text (Hard Rule 10):
 *  - `invalid_input`: a row the ledger refused (fields outside its source's allowlist, a self-chosen contentHash,
 *    a `sightedAt`, an unknown observer, a source the observer does not read), or a ping or snapshot that cannot be
 *    what it says (a Gmail window after its sync, a receipt window wider than one instant);
 *  - `id_conflict`: a different fact under a stored hash;
 *  - `late_sighting`: a sighting earlier than the stored one, or a snapshot older than the stored one;
 *  - `refused`: coverage of a pass whose rows were refused (no window is reported as seen past a refused row);
 *  - `clock_behind`: a row, ping or snapshot read after the service worker's clock now reads (the clock went back
 *    since): nothing of it is stored, and the observer is not DEGRADED;
 *  - `failed`: the service worker could not store it (the ledger did not open, a bug); logged at error;
 *  - `reader_off`: the person turned this observer's page reader off in the options page (sprint_4 4.5): nothing of
 *    it is stored, the observer is not DEGRADED, and it stops (src/observers/base.ts).
 */
export const AckCode = z.enum([
  'invalid_input',
  'id_conflict',
  'late_sighting',
  'refused',
  'clock_behind',
  'failed',
  'reader_off',
]);

/** The answer to an acknowledged message (sprint_2 2.7 interface 6). */
export const BusAck = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: AckCode }),
]);

/** The message types the service worker answers with a `BusAck`. */
export type AckedType = 'adapter.health' | 'observer.observations' | 'coverage.ping' | 'calendar.snapshot';

export const ACKED_TYPES: ReadonlySet<BusMessageType> = new Set<AckedType>([
  'adapter.health',
  'observer.observations',
  'coverage.ping',
  'calendar.snapshot',
]);

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

/**
 * Claims the person pasted in the side panel (sprint_3 3.13; docs/claims-import.md §4): sent by an extension page only
 * (listen.ts), the claims only, never the text. Each is one the paste parser read for this agent (extractor
 * `import.<agent>`, an activity view, no request). The service worker stores them, grades, and answers with a
 * `ClaimsImportResult`.
 */
export const ClaimsImportMessage = z
  .strictObject({
    type: z.literal('claims.import'),
    agent: AgentId,
    claims: z.array(Claim).min(1).max(SCHEMA_LIMITS.BATCH),
    /** The minutes the log's timed entries name (sprint_3 3.14): the agent's session pings, instants only. */
    activeAt: z.array(IsoTs).max(SCHEMA_LIMITS.GRADING_INPUT),
  })
  .superRefine((message, ctx) => {
    message.claims.forEach((claim, index) => {
      const imported =
        claim.agent === message.agent &&
        claim.extractor.id === importExtractorId(message.agent) &&
        claim.sourceKind === 'activity_view' &&
        claim.requestId === undefined;
      if (!imported)
        ctx.addIssue({ code: 'custom', path: ['claims', index], message: 'not an imported claim' });
    });
  });

/** The answer to a `claims.import`: how many claims it carried and how many were new, or why it was refused. */
export const ClaimsImportResult = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    received: z.number().int().min(1).max(SCHEMA_LIMITS.BATCH),
    added: z.number().int().min(0).max(SCHEMA_LIMITS.BATCH),
  }),
  z.strictObject({ ok: z.literal(false), code: AckCode }),
]);

/** The service worker wrote to the ledger; open UI pages re-query the tables they show. */
export const LedgerChangedMessage = z.strictObject({
  type: z.literal('ledger.changed'),
  tables: z.array(LedgerTable).min(1).max(LedgerTable.options.length),
  at: IsoTs,
});

export const BusMessage = z.discriminatedUnion('type', [
  AdapterHealthMessage,
  AdapterClaimsMessage,
  AdapterScopeMessage,
  ObserverObservationsMessage,
  CoveragePingMessage,
  CalendarSnapshotMessage,
  UiQueryMessage,
  UiResultMessage,
  LedgerChangedMessage,
  ClaimsImportMessage,
  ReceiptEventMessage,
  GrantSaveMessage,
  RetentionSaveMessage,
  ReaderToggleMessage,
  FlagSetMessage,
  LedgerWipeMessage,
]);

export type LedgerTable = z.infer<typeof LedgerTable>;
export type BusMessageType = z.infer<typeof BusMessageType>;
export type AdapterHealthMessage = z.infer<typeof AdapterHealthMessage>;
export type AdapterClaimsMessage = z.infer<typeof AdapterClaimsMessage>;
export type ScopeSnapshot = z.infer<typeof ScopeSnapshot>;
export type AdapterScopeMessage = z.infer<typeof AdapterScopeMessage>;
export type ObserverObservationsMessage = z.infer<typeof ObserverObservationsMessage>;
export type CoveragePingMessage = z.infer<typeof CoveragePingMessage>;
export type CalendarSnapshotMessage = z.infer<typeof CalendarSnapshotMessage>;
export type AckCode = z.infer<typeof AckCode>;
export type BusAck = z.infer<typeof BusAck>;
export type UiQuery = z.infer<typeof UiQuery>;
export type UiQueryKind = z.infer<typeof UiQueryKind>;
export type UiQueryMessage = z.infer<typeof UiQueryMessage>;
export type UiResultError = z.infer<typeof UiResultError>;
export type UiResult = z.infer<typeof UiResultMessage>;
export type LedgerChangedMessage = z.infer<typeof LedgerChangedMessage>;
export type ClaimsImportMessage = z.infer<typeof ClaimsImportMessage>;
export type ClaimsImportResult = z.infer<typeof ClaimsImportResult>;
export type BusMessage = z.infer<typeof BusMessage>;

/** The member of the union with a given `type` (both `ui.result` shapes for `'ui.result'`). */
export type BusMessageOf<T extends BusMessageType> = Extract<BusMessage, { type: T }>;

/**
 * Every command an extension page sends, with the schema of its answer (sprint_4 close, tech review TECH-8): the
 * listener's page-only set and its check of each answer, the handlers' result types (./listen.ts) and the one sender
 * (./send.ts) all read this table, so a command is added here once, beside its message in the union. Each answers
 * `{ ok: false, code: 'failed' }` when it fails.
 */
export const PAGE_COMMAND_RESULTS = Object.freeze({
  'claims.import': ClaimsImportResult,
  'receipt.event': ReceiptEventResult,
  'grant.save': GrantSaveResult,
  'retention.save': SettingResult,
  'reader.toggle': SettingResult,
  'flag.set': SettingResult,
  'ledger.wipe': SettingResult,
} as const satisfies Partial<Record<BusMessageType, z.ZodType>>);

export type PageCommand = keyof typeof PAGE_COMMAND_RESULTS;
export type PageCommandResult<T extends PageCommand> = z.infer<(typeof PAGE_COMMAND_RESULTS)[T]>;

/** Whether `type` is a command an extension page sends. */
export const isPageCommand = (type: string): type is PageCommand => Object.hasOwn(PAGE_COMMAND_RESULTS, type);

export function isBusMessageType(value: unknown): value is BusMessageType {
  return BusMessageType.safeParse(value).success;
}

/** Whether `type` is answered with a `BusAck`. */
export function isAckedType(type: BusMessageType): boolean {
  return ACKED_TYPES.has(type);
}

export const ACK_OK: BusAck = Object.freeze({ ok: true });

/** The refusal `{ ok: false, code }`. */
export function ackRefused(code: AckCode): BusAck {
  return { ok: false, code };
}

/** The failed answer to a query of `kind`. */
export function uiFailure(kind: UiQueryKind, error: UiResultError): UiResult {
  return { type: 'ui.result', kind, ok: false, error };
}
