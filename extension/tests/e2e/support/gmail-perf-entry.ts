/**
 * TEST ONLY (Sprint 2 QA review, qa_tester rule 7): the Gmail Sent observer's pass, exposed on the page so
 * tests/e2e/gmail-sent-perf.spec.ts can time it in a real Chromium DOM. Never shipped and never given a host: WXT
 * builds only entrypoints/, this file lives under tests/, and the spec bundles it in memory and adds it to a page it
 * routes itself. It reads the page and builds the messages a content script would post; it posts nothing.
 */
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { browserOffsetAt, passMessages } from '../../../src/observers/base';
import { gmailSentObserver } from '../../../src/observers/gmail/sent-observer';
import { planPass } from '../../../src/observers/plan';
import type { IsoTs } from '../../../src/core/schema';
import { GMAIL_PERF_GLOBAL } from './gmail-perf-marker';

/** One content-script pass's work before its first post: the plan, then every message it would send. */
function pass(observedAt: IsoTs): { readonly plan: ReturnType<typeof planPass>; readonly types: string[] } {
  const ctx = { observedAt, offsetAt: browserOffsetAt };
  const plan = planPass({ observer: gmailSentObserver, doc: document, ctx, policy: DEFAULT_POLICY });
  const messages = passMessages(gmailSentObserver, plan, observedAt, false);
  return { plan, types: messages.map((message) => message.type) };
}

Object.defineProperty(window, GMAIL_PERF_GLOBAL, { value: Object.freeze({ pass }) });
