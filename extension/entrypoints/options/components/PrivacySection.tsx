import { AwayDetection } from './AwayDetection';
import { Section } from './Section';

/** What Attest keeps and where (build_spec §4, Hard Rules 1 and 2), in plain words. */
export function PrivacySection() {
  return (
    <Section id="privacy">
      <p>
        Attest keeps derived facts in this browser only: who an email went to, a short subject hint, times,
        amounts, merchants and content hashes. It never keeps email bodies, chat transcripts or full pages.
      </p>
      <p>
        This version reads your Gmail Sent folder, receipt emails you open, and Google Calendar, only in tabs
        you have open. It does not read your AI agents' pages: you paste an agent's activity log in the side
        panel, and Attest checks each action it reports.
      </p>
      <AwayDetection />
      <p class="text-neutral-600 dark:text-neutral-400">
        Telemetry and retention settings are available in a later version. Telemetry will be off unless you
        turn it on.
      </p>
    </Section>
  );
}
