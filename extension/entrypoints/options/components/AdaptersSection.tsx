import { AGENT_READERS } from '../../../src/config';
import { LaterVersionNote } from './LaterVersionNote';
import { Section } from './Section';

/** One page reader as the Adapters section shows it: what it reads, whether it runs, and why. */
interface Reader {
  readonly name: string;
  readonly on: boolean;
  readonly note: string;
}

/**
 * Every reader, in page order (sprint_3 3.10). Gmail and Google Calendar run in the tabs you open. The readers for
 * Muse, ChatGPT and Claude are off: their makers' terms forbid collecting data from their sites by automated means,
 * and Attest reads none of them without written permission (src/config.ts AGENT_READERS; Decisions [3.10]).
 */
export const READERS: readonly Reader[] = [
  {
    name: 'Gmail and Google Calendar',
    on: true,
    note: 'Reads your Gmail Sent folder, the receipts you open and Google Calendar, only in tabs you open yourself.',
  },
  {
    name: 'Muse (Meta)',
    on: AGENT_READERS.muse !== 'off',
    note: "Meta's terms do not allow collecting data from its products by automated means without its permission (Meta Terms of Service, section 3.2). Attest will read Muse only with Meta's written permission.",
  },
  {
    name: 'ChatGPT and Dots (OpenAI)',
    on: AGENT_READERS.chatgpt !== 'off',
    note: 'OpenAI\'s terms do not allow automatically or programmatically extracting data or output from its services (Terms of Use, "What you cannot do"). Attest will read ChatGPT only with OpenAI\'s permission.',
  },
  {
    name: 'Claude (Anthropic)',
    on: AGENT_READERS.claude !== 'off',
    note: "Anthropic's terms do not allow scraping or harvesting data from its services, or reaching them through a script (Consumer Terms, section 3). Attest will read Claude only with Anthropic's permission.",
  },
];

/** The Adapters section: each reader, on or off, and why. Health per reader comes later; no controls here. */
export function AdaptersSection() {
  return (
    <Section id="adapters">
      <p>The pages Attest reads, each in tabs you open yourself:</p>
      <ul class="space-y-2">
        {READERS.map((reader) => (
          <li key={reader.name}>
            <span class="font-medium">{reader.name}</span>
            <span class="ml-2 text-neutral-600 dark:text-neutral-400">{reader.on ? 'On' : 'Off'}</span>
            <p class="text-neutral-700 dark:text-neutral-300">{reader.note}</p>
          </li>
        ))}
      </ul>
      <p>Which readers are working, and which need repair after a site changes:</p>
      <LaterVersionNote />
    </Section>
  );
}
