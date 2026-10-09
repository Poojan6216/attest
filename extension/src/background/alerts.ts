/**
 * Alerts in the service worker (sprint_4 4.6; the `notifications` permission, Decisions [4.6]). After each grading
 * batch, and at every start of the worker, `deliverAlerts` settles the pending alerts (src/ledger/alerts.ts: each for
 * good, before anything is shown) and asks Chrome for one notification per alert to show, named by its receipt's id,
 * worded by src/ui/alert-text.ts. One per receipt, ever: a settled alert is never shown again, after a restart either.
 *
 * A click on one opens the side panel on that receipt (`onAlertClicked`). Chrome opens a side panel only in answer to
 * a user action, so `sidePanel.open` is called at once, in the click's own turn, for the last focused window; when
 * Chrome refuses, the side panel's page opens in a tab instead. The receipt to open is named in
 * `chrome.storage.session` (`SESSION_KEYS.OPEN_RECEIPT`), which the side panel reads when it opens and while it is
 * open (entrypoints/sidepanel/use-open-request.ts), and in the tab's address.
 */
import { browser } from 'wxt/browser';

import { isoWithLocalOffset } from '../clock';
import { SESSION_KEYS } from '../config';
import { Ulid } from '../core/schema';
import { takeAlerts } from '../ledger/alerts';
import type { LedgerDb } from '../ledger/db';
import { IsoTs } from '../ledger/types';
import { log } from '../log';
import { alertText } from '../ui/alert-text';

/** The notification Chrome is asked for: a basic one with the extension's icon. */
export interface AlertNotification {
  readonly type: 'basic';
  readonly iconUrl: string;
  readonly title: string;
  readonly message: string;
  readonly priority: number;
}

/** The part of `chrome.notifications` alerts use. */
export interface NotificationsApi {
  create(notificationId: string, options: AlertNotification): Promise<string>;
  clear(notificationId: string): Promise<boolean>;
}

export interface AlertDeps {
  readonly notifications: NotificationsApi;
  /** The extension's icon, as Chrome loads it. */
  readonly iconUrl: () => string;
  /** The clock at the edge: when an alert is settled, and what "today" is in its text. */
  readonly nowMs: () => number;
}

/** Chrome's own, in the service worker: a basic notification, as Chrome names the template. */
export const BROWSER_ALERTS: AlertDeps = {
  get notifications(): NotificationsApi {
    return {
      create: (notificationId, { iconUrl, title, message, priority }) =>
        browser.notifications.create(notificationId, {
          type: browser.notifications.TemplateType.BASIC,
          iconUrl,
          title,
          message,
          priority,
        }),
      clear: (notificationId) => browser.notifications.clear(notificationId),
    };
  },
  iconUrl: () => browser.runtime.getURL('/icon/128.png'),
  nowMs: () => Date.now(),
};

/** Settles the pending alerts and shows each one to show (header); returns how many were shown. */
export async function deliverAlerts(db: LedgerDb, deps: AlertDeps): Promise<number> {
  const nowMs = deps.nowMs();
  const { shown, quiet } = await takeAlerts(db, IsoTs.parse(isoWithLocalOffset(new Date(nowMs))));
  for (const alert of shown) {
    const { title, message } = alertText(alert, nowMs);
    try {
      await deps.notifications.create(alert.receiptId, {
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
  const muted = quiet.muted ?? 0;
  const skipped = (quiet.superseded ?? 0) + (quiet.overridden ?? 0) + (quiet.gone ?? 0);
  if (shown.length + muted + skipped > 0) log.info('alerts.settled', { shown: shown.length, muted, skipped });
  return shown.length;
}

/** The part of Chrome a click on an alert uses. */
export interface OpenDeps {
  readonly openSidePanel: () => Promise<void>;
  readonly openTab: (url: string) => Promise<unknown>;
  readonly name: (receiptId: string) => Promise<void>;
  readonly clear: (notificationId: string) => Promise<boolean>;
  readonly pageUrl: (path: string) => string;
}

/** Chrome's own: the side panel in the last focused window (`WINDOW_ID_CURRENT`). */
export const BROWSER_OPEN: OpenDeps = {
  openSidePanel: () => browser.sidePanel.open({ windowId: browser.windows.WINDOW_ID_CURRENT }),
  openTab: (url) => browser.tabs.create({ url }),
  name: (receiptId) => browser.storage.session.set({ [SESSION_KEYS.OPEN_RECEIPT]: receiptId }),
  clear: (notificationId) => browser.notifications.clear(notificationId),
  pageUrl: (path) => browser.runtime.getURL(path as '/sidepanel.html'),
};

/** A click on the alert `notificationId` (header). An id that is no receipt's is not one of Attest's alerts. */
export function onAlertClicked(notificationId: string, deps: OpenDeps = BROWSER_OPEN): void {
  const receiptId = Ulid.safeParse(notificationId);
  if (!receiptId.success) return;
  const id = receiptId.data;
  const opened = deps
    .openSidePanel()
    .catch(() => deps.openTab(deps.pageUrl(`/sidepanel.html#receipt=${id}`)));
  Promise.all([opened, deps.name(id), deps.clear(notificationId)]).then(
    () => {
      log.info('alerts.opened');
    },
    (error: unknown) => {
      log.error('alerts.open_failed', { error });
    },
  );
}
