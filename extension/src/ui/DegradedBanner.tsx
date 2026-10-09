import type { AdapterHealth } from '../ledger/types';
import { degradedLine, reportUrl } from './receipt-labels';

export interface DegradedBannerProps {
  /** The latest health report of every adapter and observer. */
  readonly health: readonly AdapterHealth[];
  /** The browser's user agent: the report link reads its Chrome major version and nothing else. */
  readonly userAgent: string;
}

/**
 * A loud yellow banner at the top of the popup and the side panel while any adapter is DEGRADED (Hard Rule 6;
 * agents/ux_engineer.md rule 3): which reader, which version, what it means, and a link that opens a new GitHub issue
 * filled in with the reader's id and version and the Chrome version, nothing else. Nothing is drawn while every
 * adapter is well.
 */
export function DegradedBanner({ health, userAgent }: DegradedBannerProps) {
  const degraded = health.filter(({ status }) => status === 'DEGRADED');
  if (degraded.length === 0) return null;
  return (
    <div
      role="alert"
      class="rounded-md border border-degraded-edge bg-degraded-bg p-row text-sm text-degraded-fg"
    >
      <ul class="space-y-1">
        {degraded.map((report) => (
          <li key={report.adapterId}>
            <strong>Degraded:</strong> {degradedLine(report)}{' '}
            <a
              href={reportUrl(report, userAgent)}
              target="_blank"
              rel="noopener noreferrer"
              class="font-semibold underline"
            >
              Report on GitHub<span class="sr-only"> (opens a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
