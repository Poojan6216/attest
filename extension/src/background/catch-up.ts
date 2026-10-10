/**
 * What runs after the ledger is unlocked (sprint_6 6.7, the privacy pre-review's retention finding): the alarms that
 * wait while it is locked (./alarms.ts) may each have found it locked, every time, for a person who unlocks only after
 * they fire. So each unlock runs them once, and each is idempotent: the retention purge, so history never outlives the
 * window chosen (it deletes nothing that is not due); the digest of the last whole week, only once it is due and only
 * if it was not made, so no digest or its notice comes twice; and the opt-in usage numbers' last whole day, which go
 * at most once a day as ever, and not at all while they are off. Grading needs nothing here: the grace alarm grades
 * within minutes. Each runs on its own, and a failure is logged under its alarm's name.
 */
import { nowIso } from '../clock';
import { ALARM_NAMES } from '../config';
import { getDigest } from '../ledger/digest';
import { lastWeek, nextDigestMs } from '../ledger/digest-week';
import { getLedger } from '../ledger/shared';
import { log } from '../log';
import { runRetentionPurge } from './alarms';
import { browserDigest, runWeeklyDigest } from './digest';
import { announce } from './router';
import { runTelemetryAlarm } from './telemetry';

/** The digest of the last whole week, if its Monday 09:00 has passed and it was not made. */
export async function digestIfDue(nowMs: number, make: () => Promise<void>): Promise<boolean> {
  const week = lastWeek(nowMs);
  if (nowMs < nextDigestMs(week.toMs - 1)) return false;
  if ((await getDigest(await getLedger(), week.week)) !== undefined) return false;
  await make();
  return true;
}

/** The catch-up after an unlock (header). */
export async function catchUpAfterUnlock(nowMs: () => number = () => Date.now()): Promise<void> {
  const notify = announce(nowIso);
  const runs = [
    [ALARM_NAMES.PURGE, runRetentionPurge()],
    [ALARM_NAMES.DIGEST, digestIfDue(nowMs(), () => runWeeklyDigest(browserDigest(notify)))],
    [ALARM_NAMES.TELEMETRY, runTelemetryAlarm(notify, nowMs)],
  ] as const;
  const settled = await Promise.allSettled(runs.map(([, run]) => run));
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      log.error('alarm.handler_failed', { alarm: runs[index]?.[0] ?? 'unknown', error: outcome.reason });
    }
  });
}
