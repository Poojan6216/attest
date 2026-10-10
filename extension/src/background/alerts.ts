/**
 * Alerts in the service worker (sprint_4 4.6; the `notifications` permission, Decisions [4.6]). After each grading
 * batch, and at a grace alarm that finds alerts pending (./alarms.ts; a worker stopped before it showed them),
 * `deliverAlerts` settles the pending alerts (src/ledger/alerts.ts: each for good, before anything is shown) and asks
 * Chrome for one notification per alert to show, named by its receipt's id, worded by src/ui/alert-text.ts; more than
 * ALERT_BURST at once are shown as one notice that opens the timeline (sprint_4 close, tech review TECH-12). One per
 * receipt, ever: a settled alert is never shown again, after a restart either.
 *
 * A click on one opens the side panel on that receipt (`onAlertClicked`). Chrome opens a side panel only in answer to
 * a user action, so `sidePanel.open` is called at once, in the click's own turn, for the last focused window; when
 * Chrome refuses, the side panel's page opens in a tab instead. The receipt to open is named in
 * `chrome.storage.session` (`SESSION_KEYS.OPEN_RECEIPT`), which the side panel reads when it opens and while it is
 * open (entrypoints/sidepanel/use-open-request.ts), and in the tab's address.
 */
import { browser } from 'wxt/browser';

import { isoWithLocalOffset } from '../clock';
import { ALERT_BURST, ALERTS_NOTIFICATION_ID, DIGEST_NOTIFICATION_ID, SESSION_KEYS } from '../config';
import { Ulid } from '../core/schema';
import { takeAlerts } from '../ledger/alerts';
import type { LedgerDb } from '../ledger/db';
import { IsoTs } from '../ledger/types';
import { log } from '../log';
import { alertBurstText, alertText } from '../ui/alert-text';

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

/** Asks Chrome for one notification; a refusal is logged, never thrown. */
async function show(deps: AlertDeps, id: string, { title, message }: { title: string; message: string }) {
  try {
    await deps.notifications.create(id, {
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

/** Settles the pending alerts and shows each one to show, or one notice for a burst (header); returns how many. */
export async function deliverAlerts(db: LedgerDb, deps: AlertDeps): Promise<number> {
  const nowMs = deps.nowMs();
  const { shown, quiet } = await takeAlerts(db, IsoTs.parse(isoWithLocalOffset(new Date(nowMs))));
  if (shown.length > ALERT_BURST) await show(deps, ALERTS_NOTIFICATION_ID, alertBurstText(shown.length));
  else for (const alert of shown) await show(deps, alert.receiptId, alertText(alert, nowMs));
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

/** The side panel opened, or, when Chrome refuses (logged), its page in a tab at `path`. */
function openPanel(deps: OpenDeps, path: string): Promise<unknown> {
  return deps.openSidePanel().catch((error: unknown) => {
    log.warn('alerts.side_panel_failed', { error });
    return deps.openTab(deps.pageUrl(path));
  });
}

/**
 * A click on the alert `notificationId` (header); on the notice of a burst, which opens the timeline; or on the notice
 * that a weekly digest is ready, which opens the digest page in a tab (sprint_4 4.7). Any other id is not Attest's.
 */
export function onAlertClicked(notificationId: string, deps: OpenDeps = BROWSER_OPEN): void {
  if (notificationId === DIGEST_NOTIFICATION_ID || notificationId === ALERTS_NOTIFICATION_ID) {
    const opened =
      notificationId === DIGEST_NOTIFICATION_ID
        ? deps.openTab(deps.pageUrl('/digest.html'))
        : openPanel(deps, '/sidepanel.html');
    Promise.all([opened, deps.clear(notificationId)]).catch((error: unknown) => {
      log.error('alerts.open_failed', { error });
    });
    return;
  }
  const receiptId = Ulid.safeParse(notificationId);
  if (!receiptId.success) return;
  const id = receiptId.data;
  const opened = openPanel(deps, `/sidepanel.html#receipt=${id}`);
  Promise.all([opened, deps.name(id), deps.clear(notificationId)]).then(
    () => {
      log.info('alerts.opened');
    },
    (error: unknown) => {
      log.error('alerts.open_failed', { error });
    },
  );
}
