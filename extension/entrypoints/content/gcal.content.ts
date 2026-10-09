/**
 * The Google Calendar content script (sprint_2 2.7). Wiring only (extension_engineer "Structure"; TECH-12): it starts
 * the Calendar observer (src/observers/gcal/observer.ts) through the observer skeleton (src/observers/base.ts), with
 * the heartbeat that keeps a visible range's snapshot fresh and a `post` that rejects when the service worker refused
 * what a pass sent (src/bus send.ts `postAcked`) and names each snapshot's account (src/observers/gcal/script.ts).
 * Which rows a pass posts and why is the observer's (src/observers/gcal/extract.ts). Read-only on the page (Hard
 * Rule 3; `attest/no-act`): nothing here touches the DOM beyond what the observer reads in its pass.
 *
 * The observer is never stopped on WXT's `ctx.onInvalidated`: the page itself can fire it by dispatching WXT's
 * start-up event (SEC-3; Decisions [2.close]). The skeleton stops it when the extension context is really gone.
 */
import '../../src/setup';

import { defineContentScript } from 'wxt/utils/define-content-script';

import { postAcked } from '../../src/bus/send';
import { OBSERVER_HEARTBEAT_MS, OBSERVER_HOSTS } from '../../src/config';
import { startObserver } from '../../src/observers/base';
import { createGcalObserver } from '../../src/observers/gcal/observer';
import { snapshotPost } from '../../src/observers/gcal/script';
import { browserOffsetAt } from '../../src/observers/time-zone';

export default defineContentScript({
  matches: [...OBSERVER_HOSTS.gcal],
  runAt: 'document_idle',
  // Registered by the service worker while the person keeps this reader on (src/background/readers.ts, sprint_4 4.5),
  // never in the manifest: a reader turned off has no registration.
  registration: 'runtime',
  // WXT's start-up handshake must not post a message the vendor page can read.
  noScriptStartedPostMessage: true,
  main() {
    const calendar = createGcalObserver({ offsetAt: browserOffsetAt });
    startObserver(calendar, { post: snapshotPost(calendar, postAcked), heartbeatMs: OBSERVER_HEARTBEAT_MS });
  },
});
