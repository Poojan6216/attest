/**
 * The Muse content script (sprint_3 3.2). Wiring only (extension_engineer "Structure"; TECH-12): it starts the Muse
 * adapter (src/adapters/muse/adapter.ts) through the adapter skeleton (src/adapters/base.ts) on Muse's own site
 * (src/config.ts AGENT_HOSTS.muse, confirmed by the founder on 2026-10-08). Read-only on the page (Hard Rule 3;
 * `attest/no-act`): nothing here touches the DOM beyond what the adapter reads in its pass.
 *
 * Until the service worker stores claims and scope snapshots (sprint_3 3.6, 3.7), a pass posts only its health, which
 * the service worker stores from Muse's site alone (src/background/sender-site.ts) and the popup shows (Hard Rule 6).
 * The Requests, Claims and scopes a pass reads stay in this content script: nothing else of a Muse page leaves it.
 *
 * As the observers' scripts, the skeleton is never stopped on WXT's `ctx.onInvalidated`, which the page itself can fire
 * (SEC-3; Decisions [2.close]); it stops when the extension context is really gone.
 */
import '../../src/setup';

import { defineContentScript } from 'wxt/utils/define-content-script';

import { startAdapters } from '../../src/adapters/base';
import { MUSE_CHAT } from '../../src/adapters/muse/adapter';
import type { BusMessage } from '../../src/bus/messages';
import { postAcked } from '../../src/bus/send';
import { AGENT_HOSTS } from '../../src/config';

/** The health report, acknowledged; claims and scopes wait for the handlers that store them (3.6, 3.7). */
async function healthOnly(message: BusMessage): Promise<void> {
  if (message.type === 'adapter.health') await postAcked(message);
}

export default defineContentScript({
  matches: [...AGENT_HOSTS.muse],
  runAt: 'document_idle',
  // WXT's start-up handshake must not post a message the vendor page can read.
  noScriptStartedPostMessage: true,
  main() {
    startAdapters([MUSE_CHAT], { post: healthOnly });
  },
});
