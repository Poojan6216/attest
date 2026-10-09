import type { Receipt, ReceiptOverride } from '../../../src/core/schema';
import { Button } from '../../../src/ui/Button';
import { gradeLabel } from '../../../src/ui/receipt-labels';
import { type SendEvent, useMark } from '../use-mark';
import { SaidLine } from './SaidLine';

export interface YourMarkProps {
  readonly receipt: Receipt;
  readonly override: ReceiptOverride;
  readonly onEvent: SendEvent;
}

/** A person's mark on a receipt, its reason, Attest's own grade beside it, and its undo (sprint_4 4.3). */
export function YourMark({ receipt, override, onEvent }: YourMarkProps) {
  const { sending, said, send } = useMark(onEvent);
  return (
    <section aria-labelledby="mark-heading" class="space-y-1">
      <h3 id="mark-heading" class="text-sm font-semibold">
        Your mark
      </h3>
      <p class="text-xs text-ink">
        You marked it {gradeLabel(override.grade)}: “{override.reason}”. Attest’s own grade,{' '}
        {gradeLabel(receipt.grade)}, stays beside it.
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          send({ kind: 'revert' }, 'Undone.');
        }}
        disabled={sending}
      >
        Undo my mark
      </Button>
      <SaidLine said={said} />
    </section>
  );
}
