import { useEffect, useRef } from 'preact/hooks';

import { Button } from '../../../src/ui/Button';
import type { ReceiptDetail } from '../../../src/ui/data';
import { claimFields } from '../../../src/ui/detail-labels';
import { EvidenceList } from '../../../src/ui/EvidenceList';
import { Fields } from '../../../src/ui/Fields';
import { ReceiptRow } from '../../../src/ui/ReceiptRow';
import type { SendEvent } from '../use-mark';
import { DetailGrading } from './DetailGrading';
import { DetailRead } from './DetailRead';
import { DetailSection } from './DetailSection';
import { OverrideControl } from './OverrideControl';
import { ShareReceipt } from './ShareReceipt';

export interface ReceiptDetailPanelProps {
  readonly detail: ReceiptDetail;
  readonly nowMs: number;
  readonly lastBatchMs: number | null;
  readonly onClose: () => void;
  readonly onEvent: SendEvent;
}

/**
 * One receipt's detail (sprint_4 4.3 done-when: "detail shows every field that fed the score"; agents/ux_engineer.md
 * rules 4 and 5): the receipt as its row shows it, the request's hint, the claim as extracted, every piece of evidence
 * with its fields, how it was graded (rule, score, each signal, confidence, every reason in words), what the grading
 * read (the grant, the context, every coverage entry), and the person's own mark. Focus moves to its heading when it
 * opens; Back returns to the timeline.
 */
export function ReceiptDetailPanel({
  detail,
  nowMs,
  lastBatchMs,
  onClose,
  onEvent,
}: ReceiptDetailPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { receipt, claim, request, observations, inputs } = detail;
  useEffect(() => {
    heading.current?.focus();
  }, [receipt.id]);
  const claimless = receipt.claimId === undefined;
  const orphan = claimless ? observations[0] : undefined;
  return (
    <section aria-labelledby="detail-heading" class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="detail-heading" ref={heading} tabIndex={-1} class="text-sm font-semibold">
          Receipt
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Back to the timeline
        </Button>
      </div>
      <ul>
        <ReceiptRow item={{ receipt, claim, orphan }} nowMs={nowMs} lastBatchMs={lastBatchMs} />
      </ul>
      {request === undefined ? null : (
        <DetailSection title="What was asked">
          <p class="text-xs text-ink">{request.textHint}</p>
        </DetailSection>
      )}
      <DetailSection title="What the agent said">
        {claim === undefined ? (
          <p class="text-xs text-ink-muted">
            {claimless ? 'No claim names this action.' : 'Attest no longer keeps this claim.'}
          </p>
        ) : (
          <Fields fields={claimFields(claim, nowMs)} />
        )}
      </DetailSection>
      <DetailSection title="Evidence">
        <EvidenceList
          observations={observations}
          nowMs={nowMs}
          emptyText="No evidence: nothing Attest saw matched."
        />
      </DetailSection>
      <DetailGrading receipt={receipt} nowMs={nowMs} />
      <DetailRead inputs={inputs} nowMs={nowMs} />
      {/* Keyed by receipt: what came of a mark on one receipt is never said under another. */}
      <OverrideControl key={receipt.id} receipt={receipt} onEvent={onEvent} />
      <ShareReceipt key={`share-${receipt.id}`} detail={detail} />
    </section>
  );
}
