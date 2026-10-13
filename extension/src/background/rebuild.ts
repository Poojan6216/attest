/**
 * Rebuilding the ledger in the service worker (Sprint 6 close, security review SEC-1; src/ledger/rebuild.ts): after a
 * job sealed every row (./crypto.ts), and at the worker's start, which first settles which bucket holds the ledger,
 * then starts a rebuild that is due. While one runs, every read and write of the ledger here waits
 * (src/ledger/shared.ts `holdLedger`), and so does every page's (the session's mark, src/ledger/rebuild-mark.ts):
 * nothing writes a row the copy has passed, or reads a bucket about to be deleted. One at a time. The worker is kept
 * running meanwhile (./keep-awake.ts), as Chrome does not count a database's work as activity.
 *
 * A rebuild that fails before the next bucket is named leaves the ledger as it was, and the rebuild due: the next start
 * tries again. One that fails after leaves the bucket before it, which the next start deletes.
 */
import { LedgerTable } from '../bus/messages';
import { readCryptoState } from '../ledger/crypto-state';
import type { LedgerDb } from '../ledger/db';
import { LedgerError } from '../ledger/errors';
import { rebuildLedgerPlace, settleLedgerPlace } from '../ledger/rebuild';
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

/** The step a failed rebuild stopped at, as src/ledger/rebuild.ts names it. */
const stepOf = (error: unknown): string =>
  error instanceof LedgerError && typeof error.context.step === 'string' ? error.context.step : 'start';

/** The rebuild, under the hold `release` releases (header); then the mark goes, and the pages read again. */
async function rebuild(release: () => void, deps: RebuildDeps): Promise<void> {
  const awake = keptAwake();
  keepAwake();
  try {
    await setRebuildMark(true);
    await closeLedger();
    await rebuildLedgerPlace();
    log.info('ledger.rebuilt');
  } catch (error) {
    log.error('ledger.rebuild_failed', { error, step: stepOf(error) });
  } finally {
    if (!awake) letSleep();
    await setRebuildMark(false).catch((error: unknown) => {
      log.error('ledger.rebuild_mark_failed', { error });
    });
    release();
    deps.notify(LedgerTable.options);
  }
}

/** Rebuilds the ledger into the next bucket now, unless a rebuild is already running (header). */
export function rebuildLedger(deps: RebuildDeps): Promise<void> {
  running ??= rebuild(holdLedger(), deps).finally(() => {
    running = undefined;
  });
  return running;
}

/**
 * At the worker's start, before anything opens the ledger (header): the hold is taken at once, so nothing opens it
 * until the bucket it is in is settled (src/ledger/rebuild.ts `settleLedgerPlace`); a rebuild due, with no job under
 * way, is started after.
 */
export function resumeRebuild(deps: RebuildDeps): Promise<void> {
  ignoreRebuildMark();
  const release = holdLedger();
  running = settleLedgerPlace()
    .then(({ moved, deleted }) => {
      if (moved || deleted > 0) log.info('ledger.place_settled', { moved, deleted });
    })
    .catch((error: unknown) => {
      log.error('ledger.rebuild_failed', { error, step: 'settle' });
    })
    .finally(() => {
      release();
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
