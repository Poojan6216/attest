/**
 * Rebuilding the ledger's database in the service worker (Sprint 6 close, security review SEC-1; src/ledger/rebuild.ts):
 * after a job sealed every row (./crypto.ts), and at the worker's start, which first finishes a rebuild a stop cut
 * short, then starts one that is due. While one runs, every read and write of the ledger here waits
 * (src/ledger/shared.ts `holdLedger`), and so does every page's (the session's mark, src/ledger/rebuild-mark.ts):
 * nothing reads a ledger half put back, or writes one about to be deleted. One at a time. The worker is kept running
 * meanwhile (./keep-awake.ts), as Chrome does not count a database's work as activity.
 *
 * A rebuild that fails while copying leaves the ledger as it was, and the rebuild due: the next start tries again. One
 * that fails while putting the rows back keeps the hold, so nothing here reads or writes a ledger that is not whole;
 * the next start puts every row back from the copy before anything else opens the ledger.
 */
import { LedgerTable } from '../bus/messages';
import { readCryptoState } from '../ledger/crypto-state';
import type { LedgerDb } from '../ledger/db';
import { copyIsWhole, copyLedger, restoreLedger } from '../ledger/rebuild';
import { setRebuildMark } from '../ledger/rebuild-mark';
import { closeLedger, holdLedger, ignoreRebuildMark } from '../ledger/shared';
import { log } from '../log';
import { keepAwake, keptAwake, letSleep } from './keep-awake';

export interface RebuildDeps {
  readonly db: () => Promise<LedgerDb>;
  /** Tells open pages every table changed: they read the rebuilt ledger again. */
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

let running: Promise<void> | undefined;

/** Ends a rebuild: the mark goes, the hold is released, and the pages read again. */
async function end(release: () => void, deps: RebuildDeps): Promise<void> {
  await setRebuildMark(false).catch((error: unknown) => {
    log.error('ledger.rebuild_mark_failed', { error });
  });
  release();
  deps.notify(LedgerTable.options);
}

/** The rebuild, under the hold `release` releases (header). */
async function rebuild(release: () => void, deps: RebuildDeps): Promise<void> {
  const awake = keptAwake();
  keepAwake();
  const sleepAsBefore = (): void => {
    if (!awake) letSleep();
  };
  try {
    await setRebuildMark(true);
    await closeLedger();
    if (!(await copyIsWhole())) await copyLedger();
  } catch (error) {
    log.error('ledger.rebuild_failed', { error, step: 'copy' });
    sleepAsBefore();
    await end(release, deps);
    return;
  }
  try {
    await restoreLedger();
  } catch (error) {
    // The copy is whole and the ledger may not be: the hold stays, and the worker may stop, so that its next start
    // puts every row back before anything else opens the ledger (header).
    log.error('ledger.rebuild_failed', { error, step: 'restore' });
    letSleep();
    return;
  }
  sleepAsBefore();
  log.info('ledger.rebuilt');
  await end(release, deps);
}

/** Rebuilds the ledger's database now, unless a rebuild is already running (header). */
export function rebuildLedger(deps: RebuildDeps): Promise<void> {
  running ??= rebuild(holdLedger(), deps).finally(() => {
    running = undefined;
  });
  return running;
}

/**
 * At the worker's start, before anything opens the ledger (header): the hold is taken at once, so nothing opens it
 * until it is known whether a whole copy waits; one that does is put back first, and a rebuild due, with no job under
 * way, is started after.
 */
export function resumeRebuild(deps: RebuildDeps): Promise<void> {
  ignoreRebuildMark();
  const release = holdLedger();
  running = copyIsWhole()
    .catch((error: unknown) => {
      log.error('ledger.rebuild_failed', { error, step: 'check' });
      return false;
    })
    .then(async (whole) => {
      if (whole) {
        log.info('ledger.rebuild_resumed');
        await rebuild(release, deps);
        return;
      }
      release();
    })
    .finally(() => {
      running = undefined;
    });
  return running
    .then(async () => {
      // Due and no job under way: a job's end makes the rebuild due again (src/ledger/crypto-writes.ts).
      const state = await readCryptoState(await deps.db());
      if (state.rebuild === true && state.job === undefined) await rebuildLedger(deps);
    })
    .catch((error: unknown) => {
      log.error('ledger.rebuild_failed', { error, step: 'check' });
    });
}
