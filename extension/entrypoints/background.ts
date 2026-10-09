import '../src/setup';

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { BROWSER_ALERTS, deliverAlerts, onAlertClicked } from '../src/background/alerts';
import { ensureAlarms, handleAlarm } from '../src/background/alarms';
import { type IdleApi, onPermissionsRemoved, watchIdle } from '../src/background/idle';
import { onInstalled } from '../src/background/install';
import { syncReaders } from '../src/background/readers';
import { createHandlers } from '../src/background/router';
import { listen } from '../src/bus/listen';
import { getLedger } from '../src/ledger/shared';
import { log } from '../src/log';

// Thin entrypoint (extension_engineer rule: business logic never lives here).
// MV3: every listener must be registered synchronously inside main() (attest/top-level-listeners).
export default defineBackground({
  type: 'module',
  main() {
    listen(createHandlers());

    browser.runtime.onInstalled.addListener((details) => {
      void onInstalled(details);
    });

    browser.runtime.onStartup.addListener(() => {
      ensureAlarms().catch((error: unknown) => {
        log.error('alarm.ensure_failed', { error });
      });
    });

    browser.alarms.onAlarm.addListener((alarm) => {
      void handleAlarm(alarm);
    });

    // A click on an alert opens the side panel on its receipt (sprint_4 4.6).
    browser.notifications.onClicked.addListener((notificationId) => {
      onAlertClicked(notificationId);
    });

    // Away detection, opt-in (sprint_3 3.14): Chrome's `idle` exists only while its optional permission is held.
    const idle = (): IdleApi | undefined => (browser as { idle?: IdleApi }).idle;
    watchIdle(idle());
    browser.permissions.onAdded.addListener(() => {
      watchIdle(idle());
    });
    browser.permissions.onRemoved.addListener((removed) => {
      onPermissionsRemoved(removed).catch((error: unknown) => {
        log.error('idle.record_failed', { error });
      });
    });

    // The page readers' content scripts are registered at runtime, as the person chose (sprint_4 4.5).
    syncReaders().catch((error: unknown) => {
      log.error('readers.sync_failed', { error });
    });

    // Alerts a batch queued before the worker last stopped are settled and shown now (sprint_4 4.6).
    getLedger()
      .then((db) => deliverAlerts(db, BROWSER_ALERTS))
      .catch((error: unknown) => {
        log.error('alerts.deliver_failed', { error });
      });

    log.info('background.started');
  },
});
