import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

import { CoverageHeader } from '../../../src/ui/CoverageHeader';
import { DegradedBanner } from '../../../src/ui/DegradedBanner';
import { type OpenRequestStore, SESSION_STORE, useOpenRequest } from '../use-open-request';
import { type TimelineSources, useTimeline } from '../use-timeline';
import { DetailView } from './DetailView';
import { TimelineFiltersForm } from './TimelineFiltersForm';
import { TimelineList } from './TimelineList';
import type { PrivacySources } from '../../../src/ui/privacy-data';
import { PrivacyLine } from '../../../src/ui/PrivacyLine';

export interface SidePanelProps {
  /** Where the panel reads and writes; the ledger and the bus when absent. */
  readonly sources?: TimelineSources;
  /** The Add agent activity flow, between what Attest checked and the receipts. */
  readonly children?: ComponentChildren;
  /** Where a clicked alert names the receipt to open (sprint_4 4.6); `chrome.storage.session` when absent. */
  readonly openRequests?: OpenRequestStore;
  /** Where the privacy line reads the person's choices; the ledger and storage when absent. */
  readonly privacy?: PrivacySources;
}

/**
 * The side panel (sprint_4 4.3): the privacy line, the degraded banner and what Attest has checked (as in the popup),
 * Add agent activity, then the timeline of receipts with its filters, or one receipt's detail: the one a clicked alert
 * names, too (sprint_4 4.6). Closing a detail returns the focus to its row.
 */
export function SidePanel({ sources, children, openRequests = SESSION_STORE, privacy }: SidePanelProps) {
  const timeline = useTimeline(sources);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useOpenRequest(timeline.open, openRequests);
  const { overview, openId } = timeline;
  const lastBatchMs = overview?.lastBatchMs ?? null;
  return (
    <main class="min-h-screen space-y-4 bg-surface p-gutter text-sm text-ink">
      <header>
        <h1 class="text-base font-semibold">Attest timeline</h1>
        <PrivacyLine sources={privacy} class="mt-1 text-ink-muted" />
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
