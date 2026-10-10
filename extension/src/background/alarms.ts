/**
 * Service-worker scheduler: `chrome.alarms`, never timers (extension_engineer rule 9).
 *
 * Alarm names are constants. On install/update every alarm that is not ours is cleared and ours are
 * (re)created, so duplicates cannot accumulate; on browser startup missing alarms are recreated
 * (Chrome may drop alarms across restarts), due PURGE_STARTUP_DELAY_MINUTES after start rather than a whole
 * period later, so a browser restarted every day still purges (sprint_2 2.7 carry-forward, Decisions [2.7]).
 * The onAlarm listener itself is registered synchronously in `entrypoints/background.ts`; this module only
 * holds the logic.
 */
import { type Browser, browser } from 'wxt/browser';

import { nowIso } from '../clock';
import {
  ALARM_NAMES,
  type AlarmName,
  GRADE_ALARM_PERIOD_MINUTES,
  GRADE_STARTUP_DELAY_MINUTES,
  PURGE_ALARM_PERIOD_MINUTES,
  PURGE_STARTUP_DELAY_MINUTES,
  TELEMETRY_ALARM_PERIOD_MINUTES,
  TELEMETRY_STARTUP_DELAY_MINUTES,
} from '../config';
import { pendingAlertCount } from '../ledger/alerts';
import { nextDigestMs } from '../ledger/digest-week';
import { getLedger } from '../ledger/repo';
import type { LedgerTable } from '../bus/messages';
import { BROWSER_ALERTS, deliverAlerts } from './alerts';
import { autoCheckGmail, browserAutoCheck } from './auto-check';
import { browserDigest, runWeeklyDigest } from './digest';
import { syncReaders } from './readers';
import { changedReceipts, runGradingBatch, SHIPPED_GRADING } from './grading';
import { askTheModel } from './intel';
import { runTelemetryAlarm } from './telemetry';
import type { LedgerDb } from '../ledger/db';
import { announce } from './router';
import { purgeAtTrustedClock } from '../ledger/retention-clock';
import { log } from '../log';

export type AlarmHandler = () => Promise<void> | void;

/**
 * The retention purge (Sprint 2.6): the dated history older than RETENTION_DAYS goes, by the rule in
 * src/ledger/retention.ts. The clock is read here, at the edge, and trusted only as far as src/ledger/
 * retention-clock.ts allows (SEC-5): a clock far ahead of what the ledger stored never purges current history. A
 * failure rejects, and `handleAlarm` logs it with the alarm name; the next daily alarm tries again (the purge is one
 * transaction: all or nothing).
 */
export async function runRetentionPurge(): Promise<void> {
  await purgeAtTrustedClock(await getLedger(), { now: nowIso() });
}

/**
 * The grace alarm (sprint_3 3.13; docs/grading.md §3, §8): one grading batch (./grading.ts), which finalises every
 * PENDING receipt whose grace has elapsed and grades whatever arrived since the last batch. Everything it needs is in
 * the ledger, so a service worker stopped mid-grace finalises at the next alarm after it restarts. When it wrote,
 * deleted or superseded a receipt, open pages are told, as after an import (tech review TECH-8). Then the advisory
 * model is asked about the claims the batch left PARTIAL, which asks nothing unless the person turned a model on
 * (sprint_5 5.4, ./intel.ts); the Gmail auto-check, which does nothing unless the person turned it on (sprint_4 4.9,
 * ./auto-check.ts); and the upkeep below.
 */
export async function runGraceBatch(
  notify: (tables: readonly LedgerTable[]) => void = announce(nowIso),
  upkeep: () => Promise<void> = graceUpkeep,
  askModel: (db: LedgerDb) => Promise<number> = (db) => askTheModel(db, { grading: SHIPPED_GRADING, notify }),
): Promise<void> {
  try {
    const db = await getLedger();
    if (changedReceipts(await runGradingBatch(db, SHIPPED_GRADING))) notify(['receipts']);
    await askModel(db);
    await autoCheckGmail(browserAutoCheck(notify));
  } finally {
    await upkeep();
  }
}

/**
 * What each grace alarm keeps in order after its batch, whether the batch ran or failed (sprint_4 close): alerts a
 * stopped worker left pending are shown, found by the `state` index (tech review TECH-6: never at every start of the
 * worker); an alarm Chrome dropped or a failed reschedule lost is set again, the weekly digest's above all, which is set
 * one at a time (QA review GAP 12); and the readers' registrations are brought in line with the person's choice. Each
 * runs on its own, and a failure is logged under its own event; the next alarm tries again.
 */
export async function graceUpkeep(): Promise<void> {
  const [alerts, alarms, readers] = await Promise.allSettled([
    getLedger().then(async (db) =>
      (await pendingAlertCount(db)) > 0 ? deliverAlerts(db, BROWSER_ALERTS) : 0,
    ),
    ensureAlarms(),
    syncReaders(),
  ]);
  if (alerts.status === 'rejected') log.error('alerts.deliver_failed', { error: alerts.reason });
  if (alarms.status === 'rejected') log.error('alarm.ensure_failed', { error: alarms.reason });
  if (readers.status === 'rejected') log.error('readers.sync_failed', { error: readers.reason });
}

/** The weekly digest (sprint_4 4.7; ./digest.ts), whose handler sets the next one. */
export async function runDigestAlarm(): Promise<void> {
  await runWeeklyDigest(browserDigest(announce(nowIso)));
}

/** One handler per alarm name. */
const HANDLERS: Readonly<Record<AlarmName, AlarmHandler>> = {
  [ALARM_NAMES.PURGE]: runRetentionPurge,
  [ALARM_NAMES.GRADE]: runGraceBatch,
  [ALARM_NAMES.DIGEST]: runDigestAlarm,
  [ALARM_NAMES.TELEMETRY]: () => runTelemetryAlarm(announce(nowIso)),
};

/**
 * How each alarm is created, at `nowMs`: on install or update, each periodic one first fires a whole period out; one
 * recreated at a browser start (`startup`) fires a short delay after it, the period following. The digest is a one-shot
 * alarm at the next Monday 09:00 (src/ledger/digest-week.ts), set again each time it fires. The telemetry alarm looks
 * each hour for a day to send, and sends nothing while telemetry is off (sprint_5 5.7, ./telemetry.ts).
 */
function createInfo(name: AlarmName, nowMs: number, startup: boolean): Browser.alarms.AlarmCreateInfo {
  switch (name) {
    case ALARM_NAMES.PURGE:
      return {
        delayInMinutes: startup ? PURGE_STARTUP_DELAY_MINUTES : PURGE_ALARM_PERIOD_MINUTES,
        periodInMinutes: PURGE_ALARM_PERIOD_MINUTES,
      };
    case ALARM_NAMES.GRADE:
      return {
        delayInMinutes: startup ? GRADE_STARTUP_DELAY_MINUTES : GRADE_ALARM_PERIOD_MINUTES,
        periodInMinutes: GRADE_ALARM_PERIOD_MINUTES,
      };
    case ALARM_NAMES.DIGEST:
      return { when: nextDigestMs(nowMs) };
    case ALARM_NAMES.TELEMETRY:
      return {
        delayInMinutes: startup ? TELEMETRY_STARTUP_DELAY_MINUTES : TELEMETRY_ALARM_PERIOD_MINUTES,
        periodInMinutes: TELEMETRY_ALARM_PERIOD_MINUTES,
      };
  }
}

export function isAttestAlarm(name: string): name is AlarmName {
  return Object.values<string>(ALARM_NAMES).includes(name);
}

/** On install/update: drop every alarm that is not ours, then (re)create ours exactly once each. */
export async function resetAlarms(): Promise<void> {
  for (const alarm of await browser.alarms.getAll()) {
    if (!isAttestAlarm(alarm.name)) await browser.alarms.clear(alarm.name);
  }
  for (const name of Object.values(ALARM_NAMES)) {
    await browser.alarms.create(name, createInfo(name, Date.now(), false));
  }
}

/**
 * On browser startup: recreate any of our alarms that Chrome dropped, due a short delay after start (a dropped daily
 * purge recreated a whole day out would never fire for a user who restarts Chrome every day); never touch existing
 * ones.
 */
export async function ensureAlarms(): Promise<void> {
  const existing = new Set((await browser.alarms.getAll()).map((alarm) => alarm.name));
  for (const name of Object.values(ALARM_NAMES)) {
    if (!existing.has(name)) await browser.alarms.create(name, createInfo(name, Date.now(), true));
  }
}

/** Body of the onAlarm listener. Never throws; handler failures are logged with the alarm name. */
export async function handleAlarm(alarm: { name: string }): Promise<void> {
  if (!isAttestAlarm(alarm.name)) {
    log.warn('alarm.unknown');
    return;
  }
  log.info('alarm.fired', { alarm: alarm.name });
  try {
    await HANDLERS[alarm.name]();
  } catch (error) {
    log.error('alarm.handler_failed', { alarm: alarm.name, error });
  }
}
