/**
 * Service-worker scheduler: `chrome.alarms`, never timers (extension_engineer rule 9).
 *
 * Alarm names are constants. On install/update every alarm that is not ours is cleared and ours are
 * (re)created, so duplicates cannot accumulate; on browser startup missing alarms are recreated
 * (Chrome may drop alarms across restarts). The onAlarm listener itself is registered synchronously
 * in `entrypoints/background.ts`; this module only holds the logic.
 */
import { browser } from 'wxt/browser';

import { ALARM_NAMES, type AlarmName, PURGE_ALARM_PERIOD_MINUTES } from '../config';
import { log } from '../log';

export type AlarmHandler = () => Promise<void> | void;

/** One handler per alarm name; later sprints replace the bodies (2.6 purge, 3.6 grace, 4.7 digest). */
const HANDLERS: Readonly<Record<AlarmName, AlarmHandler>> = {
  [ALARM_NAMES.PURGE]: () => {
    // Sprint 2.6 implements the retention purge. Until then the alarm only proves the scheduler works.
    log.info('alarm.purge_pending_implementation');
  },
};

const PERIODS: Readonly<Record<AlarmName, number>> = {
  [ALARM_NAMES.PURGE]: PURGE_ALARM_PERIOD_MINUTES,
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

/** On browser startup: recreate any of our alarms that Chrome dropped; never touch existing ones. */
export async function ensureAlarms(): Promise<void> {
  const existing = new Set((await browser.alarms.getAll()).map((alarm) => alarm.name));
  for (const name of Object.values(ALARM_NAMES)) {
    if (!existing.has(name)) {
      await browser.alarms.create(name, { delayInMinutes: PERIODS[name], periodInMinutes: PERIODS[name] });
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
