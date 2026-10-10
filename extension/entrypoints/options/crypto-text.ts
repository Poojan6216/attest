/**
 * The words of the options page's Encryption (sprint_6 6.5): what each refusal means, and whether a new passphrase is
 * one the service worker takes (src/bus/crypto-commands.ts `NewPassphrase`), checked before it is sent.
 */
import { NewPassphrase } from '../../src/bus/messages';
import { MIN_PASSPHRASE_LENGTH } from '../../src/config-crypto';
import type { CommandStep } from './use-crypto-status';

type Refusal = Extract<CommandStep, { kind: 'refused' }>['code'];

export const REFUSALS: Readonly<Record<Refusal, string>> = {
  wrong_passphrase: 'That passphrase is not the one your records are sealed with.',
  busy: 'Attest is still rewriting your records. Try again when it has finished.',
  already_on: 'Encryption is already on.',
  off: 'Encryption is already off.',
  failed: 'That did not work. Try again.',
  short: `Use at least ${String(MIN_PASSPHRASE_LENGTH)} characters, not only spaces.`,
  differ: 'The two new passphrases differ. Type the same one twice.',
  unconfirmed: 'Tick the box first: a forgotten passphrase cannot be recovered.',
};

/** Why a new passphrase and its repeat are not taken, or undefined when they are. */
export function newPassphraseProblem(passphrase: string, again: string): 'short' | 'differ' | undefined {
  if (!NewPassphrase.safeParse(passphrase).success) return 'short';
  return passphrase === again ? undefined : 'differ';
}
