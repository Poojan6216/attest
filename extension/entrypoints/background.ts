import '../src/setup';

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { onAlertClicked } from '../src/background/alerts';
import { ensureAlarms, handleAlarm } from '../src/background/alarms';
import { closeStorage } from '../src/background/byo';
import { type IdleApi, onPermissionsRemoved, watchIdle } from '../src/background/idle';
import { onInstalled } from '../src/background/install';
import { syncReaders } from '../src/background/readers';
import { createHandlers } from '../src/background/router';
import { listen } from '../src/bus/listen';
import { log } from '../src/log';

// Thin entrypoint (extension_engineer rule: business logic never lives here).
// MV3: every listener must be registered synchronously inside main() (attest/top-level-listeners).
export default defineBackground({
  type: 'module',
  main() {
    listen(createHandlers());

    // At every start of the worker, idempotent: `chrome.storage.local`, where the person's own model key is kept, is
    // closed to content scripts (src/background/byo.ts, sprint_5 5.3). Starting only at install, update and browser
    // start, it could stay open after the extension was turned off and on (Sprint 5 close, security review SEC-6).
    closeStorage().catch((error: unknown) => {
      log.error('storage.close_failed', { error });
    });

    browser.runtime.onInstalled.addListener((details) => {
      void onInstalled(details);
    });

    // A browser start: alarms Chrome dropped are set again, and the page readers' registrations follow the person's
    // choice (sprint_4 4.5). Never at every start of the worker (tech review TECH-6): the grace alarm keeps both in line.
    browser.runtime.onStartup.addListener(() => {
      ensureAlarms().catch((error: unknown) => {
        log.error('alarm.ensure_failed', { error });
      });
      syncReaders().catch((error: unknown) => {
        log.error('readers.sync_failed', { error });
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

    log.info('background.started');
  },
});
