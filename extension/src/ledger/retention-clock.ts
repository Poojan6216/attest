/**
 * The retention purge's clock (SEC-5; Hard Rules 2, 4, 5; ./retention.ts has the purge rule).
 *
 * The purge deletes dated history older than RETENTION_DAYS before "now", and what it deletes is gone for good. The
 * wall clock alone cannot be trusted with that: a machine that boots with a wrong clock, a misconfigured NTP or a
 * user who moved the date can put "now" months ahead when the purge alarm fires (it fires by wall-clock time, and one
 * minute after the browser starts when Chrome dropped it), and every claim, receipt, observation, interval and
 * Calendar record would then be purged, current ones included. The clock guard (./clock-guard.ts) repairs what was
 * stored "in the future" when the clock comes back; it cannot bring back what a purge deleted.
 *
 * So the purge runs at a TRUSTED instant: the wall clock, but no later than the latest instant the ledger itself
 * stored (its clock high water, or its clock floor after a repair), or the last purge's trusted instant plus
 * PURGE_CATCH_UP_DAYS, whichever is later:
 *
 *   trusted = min(now, max(latest stored instant, last trusted + PURGE_CATCH_UP_DAYS))
 *
 *  - Daily use: something was stored since the last purge, or the last purge ran within the catch-up, so trusted =
 *    now and the purge is exactly ./retention.ts's.
 *  - A clock far ahead with nothing stored at its time: the purge moves at most PURGE_CATCH_UP_DAYS past the last one
 *    (or not past the latest stored instant), so it deletes nothing current, and logs `ledger.purge_clock_ahead`.
 *  - A ledger left idle (the browser closed for weeks, no Gmail or Calendar tab since): the purge catches up one day
 *    faster than real time per daily run, and at once when anything is stored again. History may stay up to that
 *    long past RETENTION_DAYS; it is never deleted early.
 * A grading batch's instant is not one of them: a batch runs on an alarm, at whatever the wall clock says, with no
 * page open, so the alarm that fires with the clock ahead would otherwise vouch for that very clock.
 * Known limit: a clock that is ahead while observers store at its time is believed (the instants stored are its
 * own); that needs the clock more than RETENTION_DAYS ahead to delete history, which the guard cannot restore.
 *
 * The trusted instant is kept in `meta` (`purgeTrustedAt`), in the purge's own readwrite transaction, so a purge
 * that fails stores nothing.
 */
import { PURGE_CATCH_UP_DAYS } from '../config';
import { instantMs } from '../core/normalize';
import { MS_PER_DAY } from '../core/units';
import { log } from '../log';
import { CLOCK_FLOOR_AT, CLOCK_HIGH_WATER } from './clock-guard';
import { readInstant } from './clock-high-water';
import type { LedgerDb } from './db';
import { LedgerError } from './errors';
import { purgeExpired, type PurgeOptions, type PurgeReport } from './retention';
import { readRetentionDays } from './settings';
import { IsoTs } from './types';

/** The meta key of the last purge's trusted instant. Written only by `purgeAtTrustedClock`. */
export const PURGE_TRUSTED_AT = 'purgeTrustedAt';

const CATCH_UP_MS = PURGE_CATCH_UP_DAYS * MS_PER_DAY;

/** The latest instant the ledger stored (its high water, or the floor a repair left), or undefined when none. */
async function latestStoredMs(db: LedgerDb): Promise<number | undefined> {
  const instants = [await readInstant(db, CLOCK_HIGH_WATER), await readInstant(db, CLOCK_FLOOR_AT)]
    .filter((at) => at !== undefined)
    .map((at) => instantMs(at));
  return instants.length === 0 ? undefined : Math.max(...instants);
}

/** The header's trusted instant at the wall clock `nowMs`, read inside the purge's transaction. */
export async function trustedPurgeMs(db: LedgerDb, nowMs: number): Promise<number> {
  const latest = await latestStoredMs(db);
  const last = await readInstant(db, PURGE_TRUSTED_AT);
  const bounds = [latest, last === undefined ? undefined : instantMs(last) + CATCH_UP_MS].filter(
    (bound) => bound !== undefined,
  );
  return bounds.length === 0 ? nowMs : Math.min(nowMs, Math.max(...bounds));
}

/**
 * ./retention.ts `purgeExpired` at the trusted instant of the header, in one readwrite transaction over the purge's
 * tables and `meta`, which also stores the trusted instant, with the retention window the person chose (./settings.ts)
 * unless `options.retentionDays` names one. Throws `LedgerError('invalid_input')` for a malformed `now`, before anything
 * is read.
 */
export async function purgeAtTrustedClock(db: LedgerDb, options: PurgeOptions): Promise<PurgeReport> {
  const now = IsoTs.safeParse(options.now);
  if (!now.success) {
    throw new LedgerError('invalid_input', 'now must be ISO 8601 with an offset', { paths: 'now' });
  }
  const nowMs = instantMs(now.data);
  const tables = [
    db.meta,
    db.claims,
    db.receipts,
    db.observations,
    db.requests,
    db.coverage,
    db.coverageIntervals,
    db.calendarSnapshots,
    db.activity,
    db.receiptInputs,
    db.policies,
    db.batchCoverages,
    db.alerts,
    db.digests,
    db.modelAnswers,
  ];
  return db.transaction('rw', tables, async (): Promise<PurgeReport> => {
    const trustedMs = await trustedPurgeMs(db, nowMs);
    const trustedAt = trustedMs === nowMs ? now.data : IsoTs.parse(new Date(trustedMs).toISOString());
    if (nowMs - trustedMs > CATCH_UP_MS) log.warn('ledger.purge_clock_ahead', { now: now.data, trustedAt });
    // The window the person chose (./settings.ts), unless the caller names one.
    const retentionDays = options.retentionDays ?? (await readRetentionDays(db));
    const report = await purgeExpired(db, { ...options, now: trustedAt, retentionDays });
    await db.meta.put({ key: PURGE_TRUSTED_AT, value: trustedAt });
    return report;
  });
}
