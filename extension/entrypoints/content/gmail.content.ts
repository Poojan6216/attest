/**
 * The Gmail content script (sprint_2 2.7). Thin (extension_engineer "Structure"): it starts the two Gmail observers,
 * the Sent list (src/observers/gmail/sent-observer.ts) and the opened receipt (src/observers/gmail/receipts/),
 * through the observer skeleton (src/observers/base.ts: health → extract → redact.project → bus), together, so the
 * tab has one MutationObserver and one activity tracker for both (TECH-2). Their `post` rejects when the service
 * worker refused what a pass sent (src/bus send.ts `postAcked`), so a pass stops before it claims a window it could not
 * report (Hard Rule 5). Read-only on the page (Hard Rule 3; `attest/no-act`): nothing here touches the DOM.
 *
 * WXT's start-up handshake: `noScriptStartedPostMessage` drops its `window.postMessage`, but WXT still dispatches and
 * listens for its start-up CustomEvent on `document`, which the page can read (so a page that knows Attest's id can
 * tell it is installed) and forge (which fires `ctx.onInvalidated`). So the observers are never stopped on
 * `ctx.onInvalidated` (Decisions [2.close] S5, SEC-3): the skeleton stops them itself when the extension context is
 * really gone (a post refused `context_invalidated`, or no runtime id).
 */
import '../../src/setup';

import { defineContentScript } from 'wxt/utils/define-content-script';

import { postAcked } from '../../src/bus/send';
import { OBSERVER_HOSTS } from '../../src/config';
import { startObservers } from '../../src/observers/base';
import { receiptObserver } from '../../src/observers/gmail/receipts';
import { gmailSentObserver } from '../../src/observers/gmail/sent-observer';

export default defineContentScript({
  matches: [...OBSERVER_HOSTS.gmail],
  runAt: 'document_idle',
  // WXT's start-up handshake must not post a message the vendor page can read.
  noScriptStartedPostMessage: true,
  main() {
    startObservers([gmailSentObserver, receiptObserver], { post: postAcked });
  },
});
