import '../src/setup';

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { ensureAlarms, handleAlarm, resetAlarms } from '../src/background/alarms';
import { handleInstalled } from '../src/background/install';
import { createHandlers } from '../src/background/router';
import { listen } from '../src/bus/listen';
import { log } from '../src/log';

// Thin entrypoint (extension_engineer rule: business logic never lives here).
// MV3: every listener must be registered synchronously inside main() (attest/top-level-listeners).
export default defineBackground({
  type: 'module',
  main() {
    listen(createHandlers());

    browser.runtime.onInstalled.addListener((details) => {
      handleInstalled(details)
        .then(() => resetAlarms())
        .catch((error: unknown) => {
          log.error('install.failed', { error });
        });
    });

    browser.runtime.onStartup.addListener(() => {
      ensureAlarms().catch((error: unknown) => {
        log.error('alarm.ensure_failed', { error });
      });
    });

    browser.alarms.onAlarm.addListener((alarm) => {
      void handleAlarm(alarm);
    });

    log.info('background.started');
  },
});
