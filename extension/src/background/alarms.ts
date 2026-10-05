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
import { browser } from 'wxt/browser';

import { nowIso } from '../clock';
import {
  ALARM_NAMES,
  type AlarmName,
  PURGE_ALARM_PERIOD_MINUTES,
  PURGE_STARTUP_DELAY_MINUTES,
} from '../config';
import { getLedger } from '../ledger/repo';
import { purgeExpired } from '../ledger/retention';
import { log } from '../log';

export type AlarmHandler = () => Promise<void> | void;

/**
 * The retention purge (Sprint 2.6): the dated history older than RETENTION_DAYS goes, by the rule in
 * src/ledger/retention.ts. The clock is read here, at the edge. A failure rejects, and `handleAlarm` logs it with
 * the alarm name; the next daily alarm tries again (the purge is one transaction: all or nothing).
 */
export async function runRetentionPurge(): Promise<void> {
  await purgeExpired(await getLedger(), { now: nowIso() });
}

/** One handler per alarm name; later sprints add theirs (3.6 grace, 4.7 digest). */
const HANDLERS: Readonly<Record<AlarmName, AlarmHandler>> = {
  [ALARM_NAMES.PURGE]: runRetentionPurge,
};

const PERIODS: Readonly<Record<AlarmName, number>> = {
  [ALARM_NAMES.PURGE]: PURGE_ALARM_PERIOD_MINUTES,
};

/** How soon a recreated alarm first fires after a browser start (the period follows). */
const STARTUP_DELAYS: Readonly<Record<AlarmName, number>> = {
  [ALARM_NAMES.PURGE]: PURGE_STARTUP_DELAY_MINUTES,
};

export function isAttestAlarm(name: string): name is AlarmName {
  return Object.values<string>(ALARM_NAMES).includes(name);
}

/** On install/update: drop every alarm that is not ours, then (re)create ours exactly once each. */
export async function resetAlarms(): Promise<void> {
  for (const alarm of await browser.alarms.getAll()) {
    if (!isAttestAlarm(alarm.name)) await browser.alarms.clear(alarm.name);
  }
  for (const name of Object.values(ALARM_NAMES)) {
    await browser.alarms.create(name, { delayInMinutes: PERIODS[name], periodInMinutes: PERIODS[name] });
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
    if (!existing.has(name)) {
      await browser.alarms.create(name, {
        delayInMinutes: STARTUP_DELAYS[name],
        periodInMinutes: PERIODS[name],
      });
    }
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
