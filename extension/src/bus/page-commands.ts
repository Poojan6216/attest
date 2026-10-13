/**
 * The commands an extension page sends the service worker for a change a person made (sprint_4): a mark on a receipt
 * (`receipt.event`), an agent's grant (`grant.save`), the retention window (`retention.save`), a page reader on or off
 * (`reader.toggle`), a feature flag on or off (`flag.set`), the person's own model key (`byo.save`, `byo.forget`), a
 * day's usage numbers sent now (`telemetry.send`), and deleting every Attest datum (`ledger.wipe`). Pages read
 * the ledger but never write it: the service worker, its one writer, applies each and answers with the command's
 * result. Only an extension page may send one (listen.ts `EXTENSION_PAGE_ONLY`); src/bus/messages.ts puts each in the
 * bus union and re-exports this module.
 */
import { z } from 'zod';

import { READERS, RETENTION_CHOICES, SETTABLE_FLAGS, TELEMETRY_OUTCOMES } from '../config';
import { BYO_VENDOR_NAMES } from '../config';
import { GrantChoices, OverrideGrade, ReceiptOverride, Ulid } from '../core/schema';
import { DAY_PATTERN } from '../core/schema-primitives';

/**
 * A person's override of one receipt's grade, or its revert (sprint_4 4.3; src/ledger/user-events.ts): sent by an
 * extension page only (listen.ts), the side panel's detail. The reason is the person's own words, at most 120
 * characters with at least one visible (the receipt's own override schema): it is stored on the receipt, and never
 * logged (Hard Rule 10).
 */
export const ReceiptEventMessage = z.strictObject({
  type: z.literal('receipt.event'),
  receiptId: Ulid,
  event: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('override'),
      grade: OverrideGrade,
      reason: ReceiptOverride.shape.reason,
    }),
    z.strictObject({ kind: z.literal('revert') }),
  ]),
});

/**
 * Why a receipt event was not saved: none such, the state machine refused it, its evidence is another claim's, or it
 * failed.
 */
export const ReceiptEventCode = z.enum(['not_found', 'refused', 'evidence_taken', 'failed']);

/** The answer to a `receipt.event`: saved, or why not. */
export const ReceiptEventResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: ReceiptEventCode }),
]);

/** What a person chooses for one agent: the core schema (src/core/schema.ts), the one the ledger saves. */
export { GrantChoices };

/**
 * A person's grant for one agent, and whether its alerts are muted (sprint_4 4.4): sent by an extension page only (the
 * options page's Grants). The service worker saves it on its own clock, after the last grading batch, and then grades.
 */
export const GrantSaveMessage = z.strictObject({
  type: z.literal('grant.save'),
  grant: GrantChoices,
  alertsMuted: z.boolean(),
});

/**
 * The answer to a `grant.save`: saved, or failed. A malformed one is never answered (the bus drops it,
 * src/bus/listen.ts), and the options page checks every domain before it sends (sprint_4 close, tech review TECH-9).
 */
export const GrantSaveResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: z.literal('failed') }),
]);

/** The retention window a person chose (sprint_4 4.5): one of `RETENTION_CHOICES`, in days. */
export const RetentionDays = z.literal(RETENTION_CHOICES);

/**
 * How long Attest keeps dated history (sprint_4 4.5, the options page's Privacy): the service worker stores the window
 * (src/ledger/settings.ts), and the daily purge reads it.
 */
export const RetentionSaveMessage = z.strictObject({
  type: z.literal('retention.save'),
  days: RetentionDays,
});

/** A page reader the person can turn on or off: one of `READERS`. */
export const ReaderId = z.enum(READERS);

/**
 * A page reader on or off (sprint_4 4.5, the options page's Adapters): the service worker keeps the choice and
 * registers that reader's content script, or removes its registration, at once (src/background/readers.ts).
 */
export const ReaderToggleMessage = z.strictObject({
  type: z.literal('reader.toggle'),
  reader: ReaderId,
  on: z.boolean(),
});

/** A feature flag the person can turn on or off: one of `SETTABLE_FLAGS`. */
export const SettableFlag = z.enum(SETTABLE_FLAGS);

/**
 * A feature flag on or off (sprint_4 4.9, the options page's Adapters: the Gmail auto-check; sprint_5 5.2, 5.3, its
 * Model: the on-device model and the person's own key): the service worker keeps the choice in ledger meta
 * (src/background/flags.ts, src/ledger/consent.ts), and the next grading batch reads it.
 */
export const FlagSetMessage = z.strictObject({
  type: z.literal('flag.set'),
  flag: SettableFlag,
  on: z.boolean(),
});

/** A model vendor a person may bring their own key for (src/config.ts BYO_VENDORS). */
export const ByoVendorName = z.enum(BYO_VENDOR_NAMES);

/**
 * A model key as its vendor writes it: letters, digits, `-` and `_`, 20 to 300 characters. Never logged: a refused
 * one is logged by message type alone (Hard Rule 10).
 */
export const ByoKey = z.string().regex(/^[A-Za-z0-9_-]{20,300}$/u, 'must be a key as its vendor wrote it');

/**
 * Whether `key` is written as `vendor` writes its keys (Sprint 5 close, security review SEC-7): Anthropic's begin
 * `sk-ant-`, OpenAI's begin `sk-` and never `sk-ant-`. So a key saved under the wrong vendor is refused, never sent to
 * the other company.
 */
export function keyFitsVendor(vendor: z.infer<typeof ByoVendorName>, key: string): boolean {
  return vendor === 'anthropic'
    ? key.startsWith('sk-ant-')
    : key.startsWith('sk-') && !key.startsWith('sk-ant-');
}

/**
 * The person's own model key and its vendor (sprint_5 5.3, the options page's Model): the service worker keeps them
 * where only the extension's own pages and service worker can read them (src/background/byo.ts).
 */
export const ByoSaveMessage = z
  .strictObject({
    type: z.literal('byo.save'),
    vendor: ByoVendorName,
    key: ByoKey,
  })
  .refine(({ vendor, key }) => keyFitsVendor(vendor, key), {
    path: ['key'],
    message: 'must be a key of its vendor',
  });

/** Forgets the person's own model key: the service worker deletes it and turns their own key off. */
export const ByoForgetMessage = z.strictObject({ type: z.literal('byo.forget') });

/**
 * Delete all Attest data (sprint_4 4.5, the options page's Danger zone): the service worker deletes the ledger's
 * database, clears `chrome.storage.local`, `chrome.storage.session` and Attest's notifications, and keeps only which
 * readers the person turned off, a choice and never data (src/background/settings.ts `onLedgerWipe`; security review
 * SEC-6). The page asks twice before it sends this.
 */
export const LedgerWipeMessage = z.strictObject({ type: z.literal('ledger.wipe') });

/**
 * Sends the opt-in telemetry's last whole day now, if it is on and that day was not sent (sprint_5 5.7; the options
 * page's "Send a test payload now"): the same one call as the hourly alarm's (src/telemetry/send.ts).
 */
export const TelemetrySendMessage = z.strictObject({ type: z.literal('telemetry.send') });

/** What a `telemetry.send` did (src/telemetry/send.ts `TelemetryOutcome`) and the day it was about; or failed. */
export const TelemetrySendResult = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    outcome: z.enum(TELEMETRY_OUTCOMES),
    day: z.string().regex(DAY_PATTERN),
  }),
  z.strictObject({ ok: z.literal(false), code: z.enum(['failed']) }),
]);

/** The answer to a `retention.save`, a `reader.toggle`, a `flag.set`, a `byo.save`, a `byo.forget` or a `ledger.wipe`: done, or failed. */
export const SettingResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: z.enum(['failed']) }),
]);

export type ReceiptEventMessage = z.infer<typeof ReceiptEventMessage>;
export type ReceiptEventCode = z.infer<typeof ReceiptEventCode>;
export type ReceiptEventResult = z.infer<typeof ReceiptEventResult>;
export type GrantSaveMessage = z.infer<typeof GrantSaveMessage>;
export type GrantSaveResult = z.infer<typeof GrantSaveResult>;
export type RetentionDays = z.infer<typeof RetentionDays>;
export type RetentionSaveMessage = z.infer<typeof RetentionSaveMessage>;
export type ReaderToggleMessage = z.infer<typeof ReaderToggleMessage>;
export type FlagSetMessage = z.infer<typeof FlagSetMessage>;
export type LedgerWipeMessage = z.infer<typeof LedgerWipeMessage>;
export type ByoSaveMessage = z.infer<typeof ByoSaveMessage>;
export type ByoForgetMessage = z.infer<typeof ByoForgetMessage>;
export type SettingResult = z.infer<typeof SettingResult>;
export type TelemetrySendMessage = z.infer<typeof TelemetrySendMessage>;
export type TelemetrySendResult = z.infer<typeof TelemetrySendResult>;
