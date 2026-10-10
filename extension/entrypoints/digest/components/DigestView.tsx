import type { DigestRecord } from '../../../src/ledger/types';
import { weekLabel } from '../../../src/ui/digest-labels';
import { clockTime } from '../../../src/ui/format';
import { AgentWeekCard } from './AgentWeekCard';
import { DigestCoverage } from './DigestCoverage';
import { MarksSection } from './MarksSection';
import { NotableItem } from './NotableItem';
import { ShareDigest, type ShareTools } from './ShareDigest';

export interface DigestViewProps {
  readonly digest: DigestRecord;
  /** The instant "made" is written against. */
  readonly nowMs: number;
  readonly share: ShareTools;
}

/**
 * One week's digest (sprint_4 4.7): each agent's week, the receipts to look at, the person's marks with their reasons
 * (sprint_4 close, TECH-4), the days a source was not checked, the readers' health, and the share. A view of the stored
 * digest: it computes nothing.
 */
export function DigestView({ digest, nowMs, share }: DigestViewProps) {
  const more = digest.notableCount - digest.notable.length;
  return (
    <article aria-labelledby="digest-heading" class="space-y-6">
      <header>
        <h2 id="digest-heading" class="text-lg font-semibold">
          {weekLabel(digest.week)}
        </h2>
        <p class="text-ink-muted">Made {clockTime(digest.createdAt, nowMs)}, from this browser’s ledger.</p>
      </header>
      <section aria-labelledby="agents-heading" class="space-y-2">
        <h2 id="agents-heading" class="text-base font-semibold">
          Your agents
        </h2>
        {digest.agents.length === 0 ? (
          <p>No agent receipt was graded this week.</p>
        ) : (
          <ul class="space-y-3">
            {digest.agents.map((week) => (
              <AgentWeekCard key={week.agent} week={week} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="notable-heading" class="space-y-2">
        <h2 id="notable-heading" class="text-base font-semibold">
          To look at
        </h2>
        {digest.notable.length === 0 ? (
          <p>Nothing ended Not found, Unasked or Over scope.</p>
        ) : (
          <ul class="space-y-2">
            {digest.notable.map((receipt) => (
              <NotableItem key={receipt.receiptId} receipt={receipt} />
            ))}
          </ul>
        )}
        {more > 0 ? <p>And {String(more)} more, in the side panel’s timeline.</p> : null}
      </section>
      <MarksSection digest={digest} />
      <DigestCoverage digest={digest} />
      <ShareDigest digest={digest} {...share} />
    </article>
  );
}
