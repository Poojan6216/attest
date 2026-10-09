import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import { CoverageHeader } from '../../../src/ui/CoverageHeader';
import { DegradedBanner } from '../../../src/ui/DegradedBanner';
import { type TimelineSources, useTimeline } from '../use-timeline';
import { DetailView } from './DetailView';
import { TimelineFiltersForm } from './TimelineFiltersForm';
import { TimelineList } from './TimelineList';

export interface SidePanelProps {
  /** Where the panel reads and writes; the ledger and the bus when absent. */
  readonly sources?: TimelineSources;
  /** The Add agent activity flow, between what Attest checked and the receipts. */
  readonly children?: ComponentChildren;
}

/**
 * The side panel (sprint_4 4.3): the privacy line, the degraded banner and what Attest has checked (as in the popup),
 * Add agent activity, then the timeline of receipts with its filters, or one receipt's detail. Closing a detail
 * returns the focus to its row.
 */
export function SidePanel({ sources, children }: SidePanelProps) {
  const timeline = useTimeline(sources);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const { overview, openId } = timeline;
  const lastBatchMs = overview?.lastBatchMs ?? null;
  return (
    <main class="min-h-screen space-y-4 bg-surface p-gutter text-sm text-ink">
      <header>
        <h1 class="text-base font-semibold">Attest timeline</h1>
        <p class="mt-1 text-ink-muted">Nothing leaves your browser.</p>
      </header>
      {overview === null ? null : (
        <>
          <DegradedBanner health={overview.health} userAgent={navigator.userAgent} />
          <CoverageHeader coverage={overview.coverage} nowMs={timeline.nowMs} />
        </>
      )}
      {children}
      {openId === null ? (
        <section aria-labelledby="timeline-heading" class="space-y-3">
          <h2 id="timeline-heading" class="text-sm font-semibold">
            Receipts
          </h2>
          <TimelineFiltersForm filters={timeline.filters} onChange={timeline.setFilters} />
          <TimelineList
            list={timeline.list}
            nowMs={timeline.nowMs}
            lastBatchMs={lastBatchMs}
            onOpen={(id) => {
              setReturnTo(null);
              timeline.open(id);
            }}
            onMore={timeline.loadMore}
            returnTo={returnTo}
          />
        </section>
      ) : (
        <DetailView
          timeline={timeline}
          lastBatchMs={lastBatchMs}
          onClose={() => {
            setReturnTo(openId);
            timeline.open(null);
          }}
        />
      )}
    </main>
  );
}
