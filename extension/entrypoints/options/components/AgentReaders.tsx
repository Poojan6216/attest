import { AGENT_READERS } from '../../../src/config';

/** One agent's reader as the Adapters section shows it: whether it runs, and why not. */
interface AgentReader {
  readonly name: string;
  readonly on: boolean;
  readonly note: string;
}

/**
 * The agents' readers (sprint_3 3.10). Each is off: its maker's terms forbid collecting data from its site by automated
 * means, and Attest reads none of them without written permission (src/config.ts AGENT_READERS; Decisions [3.10]).
 */
export const AGENT_READER_NOTES: readonly AgentReader[] = [
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

/** The agents' readers, each off, and why: you paste an agent's log in the side panel instead. No controls. */
export function AgentReaders() {
  return (
    <div class="space-y-2">
      <h3 class="font-semibold">Your agents' pages</h3>
      <p class="text-sm">
        Attest does not read your agents' pages: you paste an agent's activity log in the side panel instead.
      </p>
      <ul class="space-y-2">
        {AGENT_READER_NOTES.map((reader) => (
          <li key={reader.name}>
            <span class="font-medium">{reader.name}</span>
            <span class="ml-2 text-neutral-600 dark:text-neutral-400">{reader.on ? 'On' : 'Off'}</span>
            <p class="text-sm text-neutral-700 dark:text-neutral-300">{reader.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
