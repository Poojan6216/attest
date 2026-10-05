/**
 * The Google Calendar content script (sprint_2 2.7). Thin (extension_engineer "Structure"): it starts the Calendar
 * observer (src/observers/gcal/observer.ts) through the observer skeleton (src/observers/base.ts) with a `post` that
 * rejects when the service worker refused what a pass sent (src/bus send.ts `postAcked`). Read-only on the page
 * (Hard Rule 3; `attest/no-act`): nothing here touches the DOM beyond what the observer reads in its pass.
 *
 * Who derives the Calendar rows (Decisions [2.7]; Hard Rules 5, 7). A content script cannot read the ledger, so it
 * never holds the range's previous snapshot; the service worker does. So, on a page whose account is known, a pass
 * posts no rows of its own: it posts its health, its coverage pings and its snapshot, and the service worker derives
 * every row from the step between the stored snapshot and this one (src/background/calendar-pass.ts). Otherwise a
 * first look in every tab would post each event as a first sighting, and an event edited while no Calendar tab was
 * open would come back as a `calendar.created` of its new state: a creation nobody made. A page with no account is
 * compared with nothing (src/observers/gcal/extract.ts): its passes post the observer's own first sightings, and
 * coverage without an account (graded as capped).
 *
 * The snapshot message carries the hash of the account that same pass read (`accountHash`, never the address), taken
 * from the pass's own read of the page in `extract`: the service worker keys its snapshots by account.
 */
import '../../src/setup';

import { defineContentScript } from 'wxt/utils/define-content-script';

import type { BusMessage } from '../../src/bus/messages';
import { postAcked } from '../../src/bus/send';
import { OBSERVER_HEARTBEAT_MS, OBSERVER_HOSTS } from '../../src/config';
import type { Sha256 } from '../../src/core/schema';
import { accountHashOf } from '../../src/observers/account';
import { browserOffsetAt, startObserver } from '../../src/observers/base';
import { createGcalObserver, type GcalObserver } from '../../src/observers/gcal/observer';
import type { ExtractContext, Observer, RawRow } from '../../src/observers/types';

/** The last pass's instant and the hash of the account it read (null when the page showed none). */
interface PassAccount {
  readonly at: string;
  readonly accountHash: Sha256 | null;
}

/** The Calendar observer as this content script runs it, and the `post` that names each snapshot's account. */
export function calendarScript(calendar: GcalObserver): {
  readonly observer: Observer;
  readonly post: (message: BusMessage) => Promise<void>;
} {
  let pass: PassAccount | null = null;
  const extract = (doc: Document, ctx: ExtractContext): readonly RawRow[] => {
    const address = calendar.account(doc);
    const accountHash = address === null ? null : accountHashOf(address);
    pass = { at: ctx.observedAt, accountHash };
    return address === null ? calendar.extract(doc, ctx) : [];
  };
  const post = (message: BusMessage): Promise<void> => {
    if (message.type !== 'calendar.snapshot') return postAcked(message);
    const read = pass;
    if (read?.accountHash == null || read.at !== message.snapshot.readAt) return postAcked(message);
    return postAcked({ ...message, accountHash: read.accountHash });
  };
  return { observer: Object.freeze({ ...calendar, extract }), post };
}

export default defineContentScript({
  matches: [...OBSERVER_HOSTS.gcal],
  runAt: 'document_idle',
  // WXT's start-up handshake must not post a message the vendor page can read.
  noScriptStartedPostMessage: true,
  main(ctx) {
    const calendar = createGcalObserver({ offsetAt: browserOffsetAt, previous: () => null });
    const { observer, post } = calendarScript(calendar);
    const handle = startObserver(observer, { post, heartbeatMs: OBSERVER_HEARTBEAT_MS });
    ctx.onInvalidated(handle.disconnect);
  },
});
