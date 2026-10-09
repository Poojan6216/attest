/**
 * The commands an extension page sends the service worker for a change a person made (sprint_4): a mark on a receipt
 * (`receipt.event`), an agent's grant (`grant.save`), the retention window (`retention.save`), a page reader on or off
 * (`reader.toggle`), a feature flag on or off (`flag.set`), and deleting every Attest datum (`ledger.wipe`). Pages read
 * the ledger but never write it: the
 * service worker, its one writer, applies each and answers with the command's result. Only an extension page may send
 * one (listen.ts `EXTENSION_PAGE_ONLY`); src/bus/messages.ts puts each in the bus union and re-exports this module.
 */
import { z } from 'zod';

import { READERS, RETENTION_CHOICES, SETTABLE_FLAGS } from '../config';
import { Grant, OverrideGrade, ReceiptOverride, Ulid } from '../core/schema';

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

/** Why a receipt event was not saved: none such, the state machine refused it, its evidence is another claim's, or it failed. */
export const ReceiptEventCode = z.enum(['not_found', 'refused', 'evidence_taken', 'failed']);

/** The answer to a `receipt.event`: saved, or why not. */
export const ReceiptEventResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: ReceiptEventCode }),
]);

const { agent, allowedTypes, counterpartyAllowlist, spendCeilingCents, spendCurrency, declaredScopes } =
  Grant.shape;

/**
 * What a person chooses for one agent (sprint_4 4.4): the `Grant` fields they declare and its rule across fields (a
 * ceiling needs its currency). Never what Attest observed (`observedScopes`, `accounts`) nor the stamp, which the
 * service worker keeps from the stored grant and stamps itself (src/ledger/grant-save.ts).
 */
export const GrantChoices = z
  .strictObject({
    agent,
    allowedTypes,
    counterpartyAllowlist,
    spendCeilingCents,
    spendCurrency,
    declaredScopes,
  })
  .refine((choices) => choices.spendCeilingCents === null || choices.spendCurrency !== undefined, {
    path: ['spendCurrency'],
    message: 'required when spendCeilingCents is set',
  });

/**
 * A person's grant for one agent, and whether its alerts are muted (sprint_4 4.4): sent by an extension page only (the
 * options page's Grants). The service worker saves it on its own clock, after the last grading batch, and then grades.
 */
export const GrantSaveMessage = z.strictObject({
  type: z.literal('grant.save'),
  grant: GrantChoices,
  alertsMuted: z.boolean(),
});

/** The answer to a `grant.save`: saved, or refused (`invalid_input`) or failed. */
export const GrantSaveResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: z.enum(['invalid_input', 'failed']) }),
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
 * A feature flag on or off (sprint_4 4.9, the options page's Adapters: the Gmail auto-check): the service worker keeps
 * the choice in `chrome.storage.local` (src/background/flags.ts), and the next grading batch reads it.
 */
export const FlagSetMessage = z.strictObject({
  type: z.literal('flag.set'),
  flag: SettableFlag,
  on: z.boolean(),
});

/**
 * Delete all Attest data (sprint_4 4.5, the options page's Danger zone): the service worker deletes the ledger's
 * database and clears `chrome.storage.local` (src/background/wipe.ts). The page asks twice before it sends this.
 */
export const LedgerWipeMessage = z.strictObject({ type: z.literal('ledger.wipe') });

/** The answer to a `retention.save`, a `reader.toggle`, a `flag.set` or a `ledger.wipe`: done, or failed. */
export const SettingResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: z.enum(['failed']) }),
]);

export type ReceiptEventMessage = z.infer<typeof ReceiptEventMessage>;
export type ReceiptEventCode = z.infer<typeof ReceiptEventCode>;
export type ReceiptEventResult = z.infer<typeof ReceiptEventResult>;
export type GrantChoices = z.infer<typeof GrantChoices>;
export type GrantSaveMessage = z.infer<typeof GrantSaveMessage>;
export type GrantSaveResult = z.infer<typeof GrantSaveResult>;
export type RetentionDays = z.infer<typeof RetentionDays>;
export type RetentionSaveMessage = z.infer<typeof RetentionSaveMessage>;
export type ReaderToggleMessage = z.infer<typeof ReaderToggleMessage>;
export type FlagSetMessage = z.infer<typeof FlagSetMessage>;
export type LedgerWipeMessage = z.infer<typeof LedgerWipeMessage>;
export type SettingResult = z.infer<typeof SettingResult>;
