import { PRIVACY_DOC_URL } from '../../../src/config';
import { Skeleton } from '../../../src/ui/Skeleton';
import { LIVE_SETTINGS, type SettingsSources, useSettings } from '../use-settings';
import { AwayDetection } from './AwayDetection';
import { RetentionControl } from './RetentionControl';
import { Section } from './Section';
import { TelemetryToggle } from './TelemetryToggle';

export interface PrivacySectionProps {
  /** Where the section reads and saves; the ledger, storage and the bus when absent. */
  readonly sources?: SettingsSources;
}

/**
 * What Attest keeps and where (build_spec §4, Hard Rules 1 and 2), in plain words, with a link to the privacy
 * architecture; how long it keeps history; telemetry, not yet built; and away detection (sprint_4 4.5).
 */
export function PrivacySection({ sources = LIVE_SETTINGS }: PrivacySectionProps) {
  const state = useSettings(sources);
  return (
    <Section id="privacy">
      <p>
        Attest keeps derived facts in this browser only: who an email went to, a short subject hint, times,
        amounts, merchants and content hashes. It never keeps email bodies, chat transcripts or full pages.
      </p>
      <p>
        This version reads your Gmail Sent folder, receipt emails you open, and Google Calendar, only in tabs
        you have open, with one exception you choose: Check Gmail for me, under Adapters, off unless you turn
        it on, lets Attest open your Gmail Sent folder itself, in a pinned tab. This version does not read
        your AI agents' pages: you paste an agent's activity log in the side panel, and Attest checks each
        action it reports.
      </p>
      <p>
        <a href={PRIVACY_DOC_URL} target="_blank" rel="noopener noreferrer" class="underline">
          How Attest keeps your data in this browser<span class="sr-only"> (opens a new tab)</span>
        </a>
      </p>
      {state.status === 'loading' ? <Skeleton rows={1} label="Loading the retention setting" /> : null}
      {state.status === 'failed' ? (
        <p role="alert" class="text-error-fg">
          Attest could not read its settings. Reload the page.
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <RetentionControl
          stored={state.view.retentionDays}
          save={(days) => sources.send({ type: 'retention.save', days })}
        />
      ) : null}
      <TelemetryToggle />
      <AwayDetection />
    </Section>
  );
}
