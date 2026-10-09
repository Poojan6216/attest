import type { ComponentChildren } from 'preact';

import { AgentId, Grade } from '../../src/ledger/types';
import { AgentBadge } from '../../src/ui/AgentBadge';
import { CoverageHeader } from '../../src/ui/CoverageHeader';
import { DegradedBanner } from '../../src/ui/DegradedBanner';
import { EmptyState } from '../../src/ui/EmptyState';
import { EvidenceList } from '../../src/ui/EvidenceList';
import { GradeChip } from '../../src/ui/GradeChip';
import { Skeleton } from '../../src/ui/Skeleton';
import { samples } from './samples';

interface DemoProps {
  readonly id: string;
  readonly title: string;
  readonly children: ComponentChildren;
}

function Demo({ id, title, children }: DemoProps) {
  return (
    <section aria-labelledby={id} class="space-y-row" data-component={title}>
      <h2 id={id} class="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The components page (sprint_4 4.1): every shared component of src/ui, with invented data, so each can be seen and
 * checked (axe-core, tests/e2e/ui-components.spec.ts) in the light and the dark theme, which follow the system's.
 * Built for development and the tests, never for the store (wxt.config.ts `releaseEntrypoints`).
 */
export function App() {
  const nowMs = Date.now();
  const sample = samples(nowMs);
  return (
    <main class="mx-auto max-w-2xl space-y-6 p-gutter">
      <h1 class="text-xl font-semibold">Attest components</h1>
      <p class="text-sm text-ink-muted">Every value on this page is invented.</p>
      <Demo id="grade-chip" title="GradeChip">
        <div class="flex flex-wrap gap-2">
          {Grade.options.map((grade) => (
            <GradeChip key={grade} grade={grade} />
          ))}
        </div>
      </Demo>
      <Demo id="agent-badge" title="AgentBadge">
        <div class="flex flex-wrap gap-2">
          {AgentId.options.map((agent) => (
            <AgentBadge key={agent} agent={agent} />
          ))}
          <AgentBadge agent="muse" likely />
        </div>
      </Demo>
      <Demo id="coverage-header" title="CoverageHeader">
        <h3 class="text-sm font-medium">Every source checked</h3>
        <CoverageHeader coverage={sample.covered} nowMs={nowMs} />
        <h3 class="text-sm font-medium">Calendar never checked, Gmail Sent hours ago</h3>
        <CoverageHeader coverage={sample.gaps} nowMs={nowMs} />
      </Demo>
      <Demo id="degraded-banner" title="DegradedBanner">
        <DegradedBanner health={sample.health} userAgent={navigator.userAgent} />
      </Demo>
      <Demo id="evidence-list" title="EvidenceList">
        <EvidenceList observations={sample.evidence} nowMs={nowMs} />
        <h3 class="text-sm font-medium">No evidence</h3>
        <EvidenceList observations={[]} nowMs={nowMs} emptyText="No evidence in what Attest has checked." />
      </Demo>
      <Demo id="empty-state" title="EmptyState">
        <EmptyState title="No receipts today">
          Add an agent's activity in the side panel to check what it did.
        </EmptyState>
      </Demo>
      <Demo id="skeleton" title="Skeleton">
        <Skeleton rows={3} label="Loading today's receipts" />
      </Demo>
    </main>
  );
}
