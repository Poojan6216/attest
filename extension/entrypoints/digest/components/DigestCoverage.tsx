import type { DigestRecord } from '../../../src/ledger/types';
import { gapLine, healthWord } from '../../../src/ui/digest-labels';
import { UNASKED_LIMIT } from '../../../src/ui/labels';
import { adapterName } from '../../../src/ui/receipt-labels';

export interface DigestCoverageProps {
  readonly digest: DigestRecord;
}

/** A reader's dot: green when working, yellow otherwise; the word beside it says which (rule 10: never colour alone). */
const dot = (status: string): string =>
  status === 'OK' ? 'bg-grade-verified-edge' : status === 'DEGRADED' ? 'bg-degraded-edge' : 'bg-ink-muted';

/**
 * What Attest could check in the week (sprint_4 4.7), in three short parts: the days a source was not checked, loud
 * as in the popup; each reader's health, one line each; and what an Unasked receipt cannot catch (sprint_6 6.9: no
 * Unasked receipt is not no unasked action), its headline always shown and its explanation one tap away.
 */
export function DigestCoverage({ digest }: DigestCoverageProps) {
  return (
    <section aria-labelledby="coverage-heading" class="space-y-3">
      <h2 id="coverage-heading" class="text-base font-semibold">
        What Attest could check
      </h2>
      <ul class="flex flex-wrap gap-2 text-sm">
        {digest.gaps.length === 0 ? (
          <li class="text-ink-muted">Gmail Sent and Calendar were checked every day.</li>
        ) : null}
        {digest.gaps.map(({ source, days }) => (
          <li
            key={source}
            class="rounded-full border border-degraded-edge bg-degraded-bg px-2 py-0.5 font-medium text-degraded-fg"
          >
            {gapLine(source, days)}
          </li>
        ))}
      </ul>
      <ul aria-label="Readers" class="space-y-1 text-sm">
        {digest.health.map(({ adapterId, status, version }) => (
          <li key={adapterId} class="flex items-center gap-2">
            <span aria-hidden="true" class={`inline-block size-2 rounded-full ${dot(status)}`} />
            {adapterName(adapterId)}: {healthWord(status)}, version {version}.
          </li>
        ))}
      </ul>
      <details class="rounded-lg border border-rule px-3 py-2 text-sm">
        <summary class="cursor-pointer font-medium">Not every unasked send is caught: why</summary>
        <p class="mt-2 text-ink-muted">{UNASKED_LIMIT}</p>
      </details>
    </section>
  );
}
