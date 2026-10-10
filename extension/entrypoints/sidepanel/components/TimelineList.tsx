import { Button } from '../../../src/ui/Button';
import { EmptyState } from '../../../src/ui/EmptyState';
import { LockedNotice } from '../../../src/ui/LockedNotice';
import { ReceiptRow } from '../../../src/ui/ReceiptRow';
import { Skeleton } from '../../../src/ui/Skeleton';
import { useListEnd, useReturnFocus } from '../use-list-end';
import type { ListState } from '../use-timeline';

export interface TimelineListProps {
  readonly list: ListState;
  readonly nowMs: number;
  readonly lastBatchMs: number | null;
  readonly onOpen: (id: string) => void;
  readonly onMore: () => void;
  /** The receipt whose detail was just closed: its Details button takes the focus back. */
  readonly returnTo: string | null;
}

/**
 * The timeline's receipts, newest first (sprint_4 4.3): skeleton rows while it reads, a clear empty state, and older
 * pages as the list's end scrolls into view, or with Show older receipts (the keyboard's way). Each row opens its
 * detail.
 */
export function TimelineList({ list, nowMs, lastBatchMs, onOpen, onMore, returnTo }: TimelineListProps) {
  const end = useListEnd(list.status === 'ready' && list.next !== null && list.more === 'idle', onMore);
  const root = useReturnFocus(returnTo);
  if (list.status === 'loading') return <Skeleton rows={5} label="Loading the timeline" />;
  if (list.status === 'locked') return <LockedNotice toShow="see your receipts" />;
  if (list.status === 'failed') {
    return (
      <p role="alert" class="text-error-fg">
        Attest could not read its records. Close the panel and open it again.
      </p>
    );
  }
  if (list.items.length === 0) {
    return (
      <EmptyState title="No receipts match these filters">Choose more agents, grades or days.</EmptyState>
    );
  }
  return (
    <div ref={root} class="space-y-2">
      <ul aria-label="Receipts" class="divide-y divide-rule">
        {list.items.map((item) => (
          <ReceiptRow
            key={item.receipt.id}
            item={item}
            nowMs={nowMs}
            lastBatchMs={lastBatchMs}
            onOpen={() => {
              onOpen(item.receipt.id);
            }}
          />
        ))}
      </ul>
      {list.next === null ? null : (
        <div ref={end}>
          <Button variant="secondary" onClick={onMore} disabled={list.more === 'loading'}>
            Show older receipts
          </Button>
        </div>
      )}
      {list.more === 'failed' ? (
        <p role="alert" class="text-xs text-error-fg">
          Could not read older receipts. Try again.
        </p>
      ) : null}
    </div>
  );
}
