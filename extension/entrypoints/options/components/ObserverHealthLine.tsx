import type { AdapterHealth } from '../../../src/ledger/types';
import { clockTime } from '../../../src/ui/format';
import { adapterName } from '../../../src/ui/receipt-labels';

export interface ObserverHealthLineProps {
  readonly observerId: string;
  /** Its last health report; none until a page of it was open. */
  readonly report: AdapterHealth | undefined;
  readonly nowMs: number;
}

const STATUS_WORDS: Readonly<Record<AdapterHealth['status'], string>> = Object.freeze({
  OK: 'Working',
  IDLE: 'Idle: no page of it open',
  DEGRADED: 'Needs repair: its receipts may be Unverifiable',
});

/**
 * One observer's health in the Adapters section (sprint_4 4.5; Hard Rule 6): its status in words, its version and when
 * it last checked; for one that needs repair, its reason codes. None yet until a page of it was open.
 */
export function ObserverHealthLine({ observerId, report, nowMs }: ObserverHealthLineProps) {
  const name = adapterName(observerId);
  if (report === undefined) {
    return <li class="text-sm">{name}: not checked yet. It checks when you open a page of it.</li>;
  }
  const reasons =
    report.status === 'DEGRADED' && report.reasons.length > 0 ? ` (${report.reasons.join(', ')})` : '';
  return (
    <li class="text-sm">
      {name}: {STATUS_WORDS[report.status]}
      {reasons}. Version {report.version}, last checked {clockTime(report.checkedAt, nowMs)}.
    </li>
  );
}
