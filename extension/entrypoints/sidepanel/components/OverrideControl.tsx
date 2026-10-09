import type { Receipt } from '../../../src/core/schema';
import { type SendEvent, useMark } from '../use-mark';
import { MarkForm } from './MarkForm';
import { YourMark } from './YourMark';

export interface OverrideControlProps {
  readonly receipt: Receipt;
  /** Sends the event to the service worker (`receipt.event`) and resolves its answer. */
  readonly onEvent: SendEvent;
}

/**
 * A person's own mark on a receipt (sprint_4 4.3; agents/ux_engineer.md copy rules): the form while there is none, or
 * the mark and its undo. Attest's grade always stays beside it. A mark that took a FINAL receipt to Not found cannot be
 * undone once another claim holds its evidence, and the panel says so. Overrides are how a person corrects Attest, and
 * also how a hurried one hides a problem, so the reason is required and shown wherever the mark is. What came of the last
 * change ("Saved.", "Undone.", or why not) is said here, so it stays when the form gives way to the mark it saved.
 */
export function OverrideControl({ receipt, onEvent }: OverrideControlProps) {
  const { override } = receipt;
  const mark = useMark(onEvent);
  return override === undefined ? (
    <MarkForm mark={mark} />
  ) : (
    <YourMark receipt={receipt} override={override} mark={mark} />
  );
}
