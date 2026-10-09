/**
 * Sends a person's mark on a receipt, or its undo, to the service worker (sprint_4 4.3), and says what happened: while
 * it runs nothing more can be sent, and after it the panel says it was saved or, in plain words, why it was not.
 */
import { useState } from 'preact/hooks';

import type { ReceiptEventCode, ReceiptEventMessage, ReceiptEventResult } from '../../src/bus/messages';

/** What the panel says when the service worker did not save the change. */
export const NOT_SAVED: Readonly<Record<ReceiptEventCode, string>> = Object.freeze({
  not_found: 'Not saved: Attest no longer keeps this receipt.',
  refused: 'Not saved: this receipt cannot take that change now.',
  evidence_taken: 'Not undone: its evidence now belongs to another claim. Mark that claim instead.',
  failed: 'Not saved. Try again.',
});

/** A line the panel says: an error, or that the change was saved. */
export type Said = { readonly kind: 'error' | 'saved'; readonly text: string } | null;

export type SendEvent = (event: ReceiptEventMessage['event']) => Promise<ReceiptEventResult>;

export function useMark(onEvent: SendEvent) {
  const [sending, setSending] = useState(false);
  const [said, say] = useState<Said>(null);
  const send = (event: ReceiptEventMessage['event'], saved: string) => {
    setSending(true);
    say(null);
    onEvent(event).then(
      (result) => {
        setSending(false);
        say(result.ok ? { kind: 'saved', text: saved } : { kind: 'error', text: NOT_SAVED[result.code] });
      },
      () => {
        setSending(false);
        say({ kind: 'error', text: NOT_SAVED.failed });
      },
    );
  };
  return { sending, said, say, send };
}

/** A mark's sending state and its line: one per receipt's detail, so the line outlives the form it came from. */
export type Mark = ReturnType<typeof useMark>;
