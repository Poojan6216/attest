import type { DigestRecord } from '../../../src/ledger/types';
import { gapLine, healthWord } from '../../../src/ui/digest-labels';
import { UNASKED_LIMIT } from '../../../src/ui/labels';
import { adapterName } from '../../../src/ui/receipt-labels';

export interface DigestCoverageProps {
  readonly digest: DigestRecord;
}

/**
 * What Attest could check in the week (sprint_4 4.7): the days a source was not checked, what an Unasked receipt cannot
 * catch (sprint_6 6.9: no Unasked receipt is not no unasked action), and each reader's health.
 */
export function DigestCoverage({ digest }: DigestCoverageProps) {
  return (
    <section aria-labelledby="coverage-heading" class="space-y-2">
      <h2 id="coverage-heading" class="text-base font-semibold">
        What Attest could check
      </h2>
      <ul class="space-y-1">
        {digest.gaps.length === 0 ? <li>Gmail Sent and Calendar were checked every day.</li> : null}
        {digest.gaps.map(({ source, days }) => (
          <li key={source}>{gapLine(source, days)}</li>
        ))}
        <li>{UNASKED_LIMIT}</li>
        {digest.health.map(({ adapterId, status, version }) => (
          <li key={adapterId}>
            {adapterName(adapterId)}: {healthWord(status)}, version {version}.
          </li>
        ))}
      </ul>
    </section>
  );
}
