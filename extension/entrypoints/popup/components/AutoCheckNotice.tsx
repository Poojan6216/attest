import type { AutoCheckRecord } from '../../../src/ledger/auto-check-record';
import { autoCheckText } from '../../../src/ui/auto-check-text';

export interface AutoCheckNoticeProps {
  readonly notice: AutoCheckRecord;
  /** When the popup read the ledger, in epoch ms. */
  readonly nowMs: number;
}

/**
 * Why a Gmail tab opened by itself (sprint_4 4.9; Hard Rule 11's one exception): shown in the popup from the moment the
 * auto-check opened Gmail's Sent folder until that open's window ends.
 */
export function AutoCheckNotice({ notice, nowMs }: AutoCheckNoticeProps) {
  return (
    <p role="status" class="rounded-md border border-rule p-row text-xs text-ink">
      {autoCheckText(notice, nowMs)}
    </p>
  );
}
