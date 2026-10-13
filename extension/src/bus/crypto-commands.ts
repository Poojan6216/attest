/**
 * The commands an extension page sends for the ledger's encryption at rest (sprint_6 6.5; src/background/crypto.ts):
 * turn it on with a passphrase (`crypto.enable`), unlock the ledger (`crypto.unlock`), lock it now (`crypto.lock`),
 * change the passphrase (`crypto.change`), turn it off (`crypto.disable`), and try a stopped job again
 * (`crypto.resume`; Sprint 6 close, tech review TECH-2), each answered with a `CryptoResult`.
 * Only an extension page may send one (src/bus/listen.ts `EXTENSION_PAGE_ONLY`): a content script never sees a
 * passphrase. A passphrase goes only to Attest's own contexts: Chrome hands a page's message to its other open pages
 * too, which drop it, and the service worker alone acts on it, deriving the key and logging neither (Hard Rule 10;
 * Sprint 6 close, SEC-9): a refused message is logged by its type alone. src/bus/messages.ts puts each in the bus union
 * and re-exports this module.
 */
import { z } from 'zod';

import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '../config-crypto';

/** A passphrase being typed to unlock: any text up to the longest taken, checked by the key it gives. */
export const Passphrase = z.string().min(1).max(MAX_PASSPHRASE_LENGTH);

/** A new passphrase: at least MIN_PASSPHRASE_LENGTH characters, not all of them spaces. */
export const NewPassphrase = Passphrase.refine(
  (text) => text.normalize('NFC').length >= MIN_PASSPHRASE_LENGTH && text.trim().length > 0,
  'must be a passphrase of at least the shortest length taken',
);

export const CryptoEnableMessage = z.strictObject({
  type: z.literal('crypto.enable'),
  passphrase: NewPassphrase,
});
export const CryptoUnlockMessage = z.strictObject({
  type: z.literal('crypto.unlock'),
  passphrase: Passphrase,
});
export const CryptoLockMessage = z.strictObject({ type: z.literal('crypto.lock') });
/** Try the job again after it stopped (tech review TECH-2): no passphrase, the ledger already unlocked. */
export const CryptoResumeMessage = z.strictObject({ type: z.literal('crypto.resume') });
export const CryptoChangeMessage = z.strictObject({
  type: z.literal('crypto.change'),
  passphrase: Passphrase,
  next: NewPassphrase,
});
export const CryptoDisableMessage = z.strictObject({
  type: z.literal('crypto.disable'),
  passphrase: Passphrase,
});

/**
 * Why a command was refused: the passphrase does not give the ledger's key (`wrong_passphrase`), the ledger's record
 * of its key cannot be read, so no passphrase can open it (`damaged`; Sprint 6 close, security review SEC-6), a job is
 * still rewriting the rows (`busy`), encryption is already on (`already_on`) or is off (`off`), or it failed.
 */
export const CryptoCode = z.enum(['wrong_passphrase', 'damaged', 'busy', 'already_on', 'off', 'failed']);

/** The answer to each command: done, or why not. */
export const CryptoResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: CryptoCode }),
]);

/** The commands, with the schema of their answer, for src/bus/messages.ts `PAGE_COMMAND_RESULTS`. */
export const CRYPTO_COMMAND_RESULTS = Object.freeze({
  'crypto.enable': CryptoResult,
  'crypto.unlock': CryptoResult,
  'crypto.lock': CryptoResult,
  'crypto.change': CryptoResult,
  'crypto.disable': CryptoResult,
  'crypto.resume': CryptoResult,
} as const);

/** The commands' types, for src/bus/messages.ts `BusMessageType`. */
export const CRYPTO_COMMAND_TYPES = [
  'crypto.enable',
  'crypto.unlock',
  'crypto.lock',
  'crypto.change',
  'crypto.disable',
  'crypto.resume',
] as const;

/** The commands' schemas, for the bus union. */
export const CRYPTO_COMMANDS = [
  CryptoEnableMessage,
  CryptoUnlockMessage,
  CryptoLockMessage,
  CryptoChangeMessage,
  CryptoDisableMessage,
  CryptoResumeMessage,
] as const;

export type CryptoEnableMessage = z.infer<typeof CryptoEnableMessage>;
export type CryptoUnlockMessage = z.infer<typeof CryptoUnlockMessage>;
export type CryptoLockMessage = z.infer<typeof CryptoLockMessage>;
export type CryptoChangeMessage = z.infer<typeof CryptoChangeMessage>;
export type CryptoDisableMessage = z.infer<typeof CryptoDisableMessage>;
export type CryptoResumeMessage = z.infer<typeof CryptoResumeMessage>;
export type CryptoCommand = (typeof CRYPTO_COMMAND_TYPES)[number];
export type CryptoCode = z.infer<typeof CryptoCode>;
export type CryptoResult = z.infer<typeof CryptoResult>;
