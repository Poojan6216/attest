import { Section } from './Section';

/** What Attest keeps and where (build_spec §4, Hard Rules 1 and 2), in plain words. */
export function PrivacySection() {
  return (
    <Section id="privacy">
      <p>
        Attest keeps derived facts in this browser only: who an email went to, a short subject hint, times,
        amounts, merchants and content hashes. It never keeps email bodies, chat transcripts or full pages.
      </p>
      <p>This version reads no pages and keeps no facts.</p>
      <p class="text-neutral-600 dark:text-neutral-400">
        Telemetry and retention settings are available in a later version. Telemetry will be off unless you
        turn it on.
      </p>
    </Section>
  );
}
