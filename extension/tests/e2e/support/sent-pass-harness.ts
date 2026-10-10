/**
 * TEST ONLY (sprint_6 6.4): one pass of the shipped Gmail Sent reader (src/observers/gmail/sent-observer.ts, planned
 * by the skeleton's own `planPass`) over the page it is injected into, timed by the page's own clock, so
 * tests/e2e/perf-gmail.spec.ts measures a pass over 10,000 rows in a real Chromium, which happy-dom is far too slow to
 * stand in for. Never shipped: the spec bundles it itself (./test-bundle.ts) and injects it into a page served at
 * Gmail's address in a browser without the extension; tests/e2e/built-bundle.spec.ts fails if any shipped file holds
 * SENT_PASS_HARNESS_MARKER.
 */
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { IsoTs } from '../../../src/core/schema';
import { gmailSentObserver } from '../../../src/observers/gmail/sent-observer';
import { planPass } from '../../../src/observers/plan';
import { SENT_PASS_HARNESS_MARKER } from './observer-harness-marker';

export interface TimedPass {
  /** The pass, from health to its coverage, in the page's milliseconds. */
  readonly ms: number;
  readonly status: string;
  readonly observations: number;
  readonly marker: string;
}

/** One pass over this page, as read at `observedAt`, in the browser's own zone. */
function timeSentPass(observedAt: string): TimedPass {
  const started = performance.now();
  const plan = planPass({
    observer: gmailSentObserver,
    doc: document,
    ctx: { observedAt: IsoTs.parse(observedAt), offsetAt: (ms: number) => -new Date(ms).getTimezoneOffset() },
    policy: DEFAULT_POLICY,
  });
  const ms = performance.now() - started;
  return {
    ms,
    status: plan.status,
    observations: plan.observations.length,
    marker: SENT_PASS_HARNESS_MARKER,
  };
}

Object.defineProperty(window, '__attestTimeSentPass', { value: timeSentPass });
