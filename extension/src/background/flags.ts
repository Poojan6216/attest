/**
 * The feature flags a person sets (src/config.ts SETTABLE_FLAGS; sprint_4 4.9): `flag.set`, which only an extension
 * page may send, stores one in ledger meta (src/ledger/consent.ts, where no script on a vendor page can write it;
 * sprint_4 close, security review SEC-3) and tells open pages. The service worker and the pages read the flags there.
 */
import type { FlagSetMessage, LedgerTable, SettingResult } from '../bus/messages';
import { saveFlag } from '../ledger/consent';
import type { LedgerDb } from '../ledger/db';
import { log } from '../log';
import { stopModelRuns } from './model-run';

/** The flags that choose a model (./intel.ts `chooseProvider`). */
const MODEL_FLAGS: ReadonlySet<string> = new Set(['ATTEST_MODEL', 'ATTEST_MODEL_BYO']);

export interface FlagContext {
  readonly db: () => Promise<LedgerDb>;
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

/** Turns `message.flag` on or off (header). */
export async function onFlagSet(message: FlagSetMessage, ctx: FlagContext): Promise<SettingResult> {
  // Switching either model stops the runs under way (SEC-2): turned off, nothing more is sent; turned on, the next run
  // takes the model the person now chose (the on-device one first).
  if (MODEL_FLAGS.has(message.flag)) stopModelRuns();
  try {
    await saveFlag(await ctx.db(), message.flag, message.on);
  } catch (error) {
    log.error('flags.set_failed', { flag: message.flag, error });
    return { ok: false, code: 'failed' };
  }
  log.info('flags.set', { flag: message.flag, on: message.on });
  ctx.notify(['meta']);
  return { ok: true };
}
