/**
 * The weekly digest in the service worker (sprint_4 4.7). On the digest alarm (Monday at 09:00 on the browser's clock,
 * src/config.ts DIGEST_WEEKDAY and DIGEST_HOUR), the next alarm is set first, so a digest that fails never stops the
 * weeks after it; then the digest of the week before is built from the ledger and kept (src/ledger/digest.ts), open
 * pages are told (`ledger.changed`: digests), and a notification says it is ready; a click opens it (./alerts.ts). A
 * browser closed on Monday morning makes it when it next starts: Chrome fires an alarm it missed then. The digest's
 * week is the last whole one before the alarm, so a late alarm makes the same week's digest.
 */
import { browser } from 'wxt/browser';

import type { LedgerTable } from '../bus/messages';
import { isoWithLocalOffset } from '../clock';
import { ALARM_NAMES, DIGEST_NOTIFICATION_ID } from '../config';
import type { LedgerDb } from '../ledger/db';
import { buildDigest, saveDigest } from '../ledger/digest';
import { lastWeek, nextDigestMs } from '../ledger/digest-week';
import { getLedger } from '../ledger/shared';
import { IsoTs } from '../ledger/types';
import { log } from '../log';
import { digestReadyText } from '../ui/digest-labels';
import { BROWSER_ALERTS, type NotificationsApi } from './alerts';

export interface DigestDeps {
  readonly db: () => Promise<LedgerDb>;
  readonly nowMs: () => number;
  readonly notify: (tables: readonly LedgerTable[]) => void;
  readonly notifications: NotificationsApi;
  readonly iconUrl: () => string;
  /** Sets the digest alarm to fire at `whenMs`, replacing any. */
  readonly schedule: (whenMs: number) => Promise<void>;
}

/** Chrome's own, in the service worker; `notify` is the router's announce. */
export function browserDigest(notify: DigestDeps['notify']): DigestDeps {
  return {
    db: getLedger,
    nowMs: () => Date.now(),
    notify,
    get notifications(): NotificationsApi {
      return BROWSER_ALERTS.notifications;
    },
    iconUrl: BROWSER_ALERTS.iconUrl,
    schedule: (whenMs) => browser.alarms.create(ALARM_NAMES.DIGEST, { when: whenMs }),
  };
}

/** Makes and keeps the digest of the last whole week (header). */
export async function runWeeklyDigest(deps: DigestDeps): Promise<void> {
  const nowMs = deps.nowMs();
  await deps.schedule(nextDigestMs(nowMs));
  const db = await deps.db();
  const digest = await buildDigest(db, lastWeek(nowMs), IsoTs.parse(isoWithLocalOffset(new Date(nowMs))));
  await saveDigest(db, digest);
  deps.notify(['digests']);
  log.info('digest.made', { agentCount: digest.agents.length, notableCount: digest.notableCount });
  const { title, message } = digestReadyText(digest);
  try {
    await deps.notifications.create(DIGEST_NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: deps.iconUrl(),
      title,
      message,
      priority: 0,
    });
  } catch (error) {
    log.error('alerts.show_failed', { error });
  }
}
