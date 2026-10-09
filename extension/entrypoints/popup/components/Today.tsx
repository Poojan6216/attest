import type { PopupView } from '../../../src/ui/data';
import { CoverageHeader } from '../../../src/ui/CoverageHeader';
import { DegradedBanner } from '../../../src/ui/DegradedBanner';
import { EmptyState } from '../../../src/ui/EmptyState';
import { ReceiptRow } from '../../../src/ui/ReceiptRow';
import { autoCheckShown } from '../../../src/ui/auto-check-text';
import { AutoCheckNotice } from './AutoCheckNotice';

export interface TodayProps {
  readonly view: PopupView;
  /** When the view was read, in epoch ms. */
  readonly nowMs: number;
  /** The browser's user agent, for the degraded banner's report link. */
  readonly userAgent: string;
}

/**
 * The popup once read (sprint_4 4.2): the degraded banner, why Gmail opened by itself if it just did (4.9), the
 * coverage header, then today's receipts newest first, or an empty state that says what to do. The heading, drawn in the same frame as the list, carries an element timing
 * name, so a test reads when Chrome painted the day (tests/e2e/support/popup-paint.ts).
 */
export function Today({ view, nowMs, userAgent }: TodayProps) {
  const { today } = view;
  return (
    <>
      <DegradedBanner health={view.health} userAgent={userAgent} />
      {autoCheckShown(view.autoCheck, nowMs) ? (
        <AutoCheckNotice notice={view.autoCheck} nowMs={nowMs} />
      ) : null}
      <CoverageHeader coverage={view.coverage} nowMs={nowMs} />
      <section aria-labelledby="today-heading" class="space-y-1">
        <h2 id="today-heading" class="text-sm font-semibold" elementtiming="today">
          Today
        </h2>
        {today.items.length === 0 ? (
          <EmptyState title="No receipts today">
            Add an agent’s activity in the timeline, and keep Gmail and Calendar open, so Attest can check
            what it did.
          </EmptyState>
        ) : (
          <ul aria-labelledby="today-heading" class="divide-y divide-rule">
            {today.items.map((item) => (
              <ReceiptRow key={item.receipt.id} item={item} nowMs={nowMs} lastBatchMs={view.lastBatchMs} />
            ))}
          </ul>
        )}
        {today.next === null ? null : (
          <p class="text-xs text-ink-muted">Older receipts from today are in the timeline.</p>
        )}
      </section>
    </>
  );
}
