/**
 * The Calendar content script's `post` (sprint_2 2.7; Decisions [2.7]; TECH-12: kept out of the entrypoint, which
 * only wires it up). The service worker keys a range's stored snapshots by account, and pairs a pass's snapshot with
 * that pass's coverage pings, refusing the pass when their accounts differ (src/background/calendar-pass.ts). The
 * skeleton builds the `calendar.snapshot` message from the snapshot alone, so this `post` adds the hash of the
 * account the same pass read (./observer.ts `passAccount`): never the address, and never another pass's account.
 * Every other message, and a snapshot whose pass named no account, goes out as the skeleton built it.
 *
 * Generic over the message type so this extractor-side module needs no bus import (eslint-rules/fences.js): the
 * entrypoint hands it src/bus `postAcked`, so a refusal still rejects and stops the pass (Hard Rule 5).
 */
import type { Sha256 } from '../../core/schema';

/** What this post reads of a message: its type. */
interface Message {
  readonly type: string;
}

/** A snapshot message, as far as this post reads it. */
interface SnapshotMessage extends Message {
  readonly type: 'calendar.snapshot';
  readonly snapshot: { readonly readAt: string };
}

function isSnapshotMessage(message: Message): message is SnapshotMessage {
  return message.type === 'calendar.snapshot';
}

/** Where a snapshot's account comes from: the observer that read it. */
export interface PassAccounts {
  readonly passAccount: (readAt: string) => Sha256 | null;
}

/** `post`, with each `calendar.snapshot` naming the account hash its own pass read (see the module comment). */
export function snapshotPost<M extends Message>(
  calendar: PassAccounts,
  post: (message: M) => Promise<void>,
): (message: M) => Promise<void> {
  return (message) => {
    if (!isSnapshotMessage(message)) return post(message);
    const accountHash = calendar.passAccount(message.snapshot.readAt);
    return post(accountHash === null ? message : { ...message, accountHash });
  };
}
