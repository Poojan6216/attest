/**
 * The Gmail content script (sprint_2 2.7). Thin (extension_engineer "Structure"): it starts the two Gmail observers,
 * the Sent list (src/observers/gmail/sent-observer.ts) and the opened receipt (src/observers/gmail/receipts/), each
 * through the observer skeleton (src/observers/base.ts: health → extract → redact.project → bus), and gives them a
 * `post` that rejects when the service worker refused what a pass sent (src/bus send.ts `postAcked`), so a pass stops
 * before it claims a window it could not report (Hard Rule 5). Read-only on the page (Hard Rule 3; `attest/no-act`):
 * nothing here touches the DOM. Stops when the extension is reloaded or updated under the page.
 */
import '../../src/setup';

import { defineContentScript } from 'wxt/utils/define-content-script';

import { postAcked } from '../../src/bus/send';
import { OBSERVER_HOSTS } from '../../src/config';
import { startObserver } from '../../src/observers/base';
import { receiptObserver } from '../../src/observers/gmail/receipts';
import { gmailSentObserver } from '../../src/observers/gmail/sent-observer';

export default defineContentScript({
  matches: [...OBSERVER_HOSTS.gmail],
  runAt: 'document_idle',
  // WXT's start-up handshake must not post a message the vendor page can read.
  noScriptStartedPostMessage: true,
  main(ctx) {
    for (const observer of [gmailSentObserver, receiptObserver]) {
      const handle = startObserver(observer, { post: postAcked });
      ctx.onInvalidated(handle.disconnect);
    }
  },
});
