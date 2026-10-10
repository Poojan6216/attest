import type { ReceiptEventMessage } from '../../../src/bus/messages';
import { Button } from '../../../src/ui/Button';
import { Skeleton } from '../../../src/ui/Skeleton';
import type { Timeline } from '../use-timeline';
import { ReceiptDetailPanel } from './ReceiptDetailPanel';

export interface DetailViewProps {
  readonly timeline: Timeline;
  readonly lastBatchMs: number | null;
  readonly onClose: () => void;
}

/** The open receipt's detail, once read; skeleton rows while it reads; and what to say when it cannot be shown. */
export function DetailView({ timeline, lastBatchMs, onClose }: DetailViewProps) {
  const { detail } = timeline;
  if (detail === 'loading') return <Skeleton rows={4} label="Loading the receipt" />;
  if (detail === 'failed' || detail === undefined) {
    return (
      <section class="space-y-2">
        <p role="alert" class="text-error-fg">
          {detail === 'failed'
            ? 'Attest could not read this receipt.'
            : 'Attest no longer keeps this receipt.'}
        </p>
        <Button variant="secondary" onClick={onClose}>
          Return to the timeline
        </Button>
      </section>
    );
  }
  const send = (event: ReceiptEventMessage['event']) => timeline.sendEvent(detail.receipt.id, event);
  return (
    <ReceiptDetailPanel
      detail={detail}
      nowMs={timeline.nowMs}
      lastBatchMs={lastBatchMs}
      onClose={onClose}
      onEvent={send}
    />
  );
}
