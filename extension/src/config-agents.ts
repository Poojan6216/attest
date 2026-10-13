/**
 * The AI agents' sites (Hard Rule 8), kept apart from src/config.ts so that the Gmail and Calendar readers, which import
 * that module, carry no agent's address in their code (Sprint 7 close, privacy review gap 15; held by
 * tests/e2e/built-bundle.spec.ts). UPPER_SNAKE only.
 */

/**
 * Host match patterns for the agent pages (Hard Rule 8). A host enters the manifest's `host_permissions` only with the
 * content script that reads it, and only while its reader is on (AGENT_READERS): none is today (wxt.config.ts;
 * Decisions [3.0], [3.10]). Dots runs on the ChatGPT host behind the ATTEST_DOTS flag.
 */
export const AGENT_HOSTS: Readonly<Record<'chatgpt' | 'claude' | 'muse', readonly string[]>> = Object.freeze({
  chatgpt: Object.freeze(['https://chatgpt.com/*']),
  claude: Object.freeze(['https://claude.ai/*']),
  // Confirmed by the founder on 2026-10-08 (MANUAL.md): the address of Muse's web app.
  muse: Object.freeze(['https://muse.ai/*']),
});

/**
 * Whether each agent's reader runs (sprint_3 3.10): off, all three. Meta's, OpenAI's and Anthropic's terms forbid
 * collecting data from their sites by automated means, and the founder chose to keep the readers off, with a note in
 * the options page (2026-10-08; the clauses are in Decisions [3.10]). So no agent host is in the manifest and no agent
 * content script ships; a reader turns on only with its vendor's written permission (Hard Rule 8).
 */
export type ReaderState = 'on' | 'off';

export const AGENT_READERS: Readonly<Record<keyof typeof AGENT_HOSTS, ReaderState>> = Object.freeze({
  muse: 'off',
  chatgpt: 'off',
  claude: 'off',
});
