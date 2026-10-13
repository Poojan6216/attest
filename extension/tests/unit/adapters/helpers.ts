/**
 * Shared pieces for the agent adapter skeleton tests (sprint_3 3.0): a synthetic chat page, activity view and settings
 * page, and an adapter that reads them. Synthetic structure and invented text, written by hand: not a capture of any
 * vendor page (fixtures first; the real Muse, ChatGPT and Claude adapters are written against captures in 3.2 to 3.4).
 */
import type { AgentAdapter, AgentRead, AgentTurn, HealthCheck } from '../../../src/adapters/types';
import { AGENT_HOSTS } from '../../../src/config-agents';

/** The pass instant tests use: ISO 8601 with an offset, as src/clock.ts writes it. */
export const NOW = '2026-10-01T14:30:00.000-04:00';

export interface SyntheticTurn {
  readonly role: 'user' | 'agent';
  readonly text: string;
  readonly at?: string;
  readonly key?: string;
}

export interface ChatPageOptions {
  readonly conversation?: string | null;
  readonly turns?: readonly SyntheticTurn[];
  readonly activity?: readonly { readonly text: string; readonly at?: string }[];
  readonly scopes?: readonly string[] | null;
}

export const TURNS: readonly SyntheticTurn[] = [
  { role: 'user', text: 'Please email Dana the venue options.', at: '2026-10-01T14:00:00-04:00', key: 't1' },
  {
    role: 'agent',
    text: 'I sent an email to dana@example.com with the venue options. Anything else?',
    at: '2026-10-01T14:01:00-04:00',
    key: 't2',
  },
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const timeHtml = (at: string | undefined): string =>
  at === undefined ? '' : `<time datetime="${escapeHtml(at)}">${escapeHtml(at)}</time>`;

/** A chat page: a main landmark naming its conversation, one `data-turn` per turn, an activity list, a settings list. */
export function chatPageHtml(options: ChatPageOptions = {}): string {
  const conversation = options.conversation === undefined ? 'c-7f3a' : options.conversation;
  const turns = (options.turns ?? TURNS)
    .map((turn) => {
      const key = turn.key === undefined ? '' : ` data-key="${escapeHtml(turn.key)}"`;
      return `<div data-turn data-role="${turn.role}"${key}><p>${escapeHtml(turn.text)}</p>${timeHtml(turn.at)}</div>`;
    })
    .join('');
  const main =
    conversation === null ? '' : `<main data-conversation="${escapeHtml(conversation)}">${turns}</main>`;
  const activity = (options.activity ?? [])
    .map((entry) => `<li data-entry><span>${escapeHtml(entry.text)}</span>${timeHtml(entry.at)}</li>`)
    .join('');
  const scopes =
    options.scopes === undefined || options.scopes === null
      ? ''
      : `<section data-settings><ul>${options.scopes.map((s) => `<li data-scope>${escapeHtml(s)}</li>`).join('')}</ul></section>`;
  return `<!doctype html><html><body>${main}<aside><ul>${activity}</ul></aside>${scopes}</body></html>`;
}

export function chatDocument(options: ChatPageOptions = {}): Document {
  return new DOMParser().parseFromString(chatPageHtml(options), 'text/html');
}

function timeOf(element: Element): string | null {
  return element.querySelector('time')?.getAttribute('datetime') ?? null;
}

/** Reads the synthetic page: turns from `[data-turn]`, entries from `[data-entry]`, scopes from `[data-scope]`. */
export function readChatPage(doc: Document): AgentRead {
  const turns: AgentTurn[] = [...doc.querySelectorAll('[data-turn]')].map((element) => {
    const key = element.getAttribute('data-key');
    return {
      role: element.getAttribute('data-role') === 'user' ? 'user' : 'agent',
      text: element.querySelector('p')?.textContent ?? '',
      time: timeOf(element),
      ...(key === null ? {} : { rowKey: key }),
    };
  });
  const activity = [...doc.querySelectorAll('[data-entry]')].map((element) => ({
    text: element.querySelector('span')?.textContent ?? '',
    time: timeOf(element),
  }));
  const settings = doc.querySelector('[data-settings]');
  return {
    conversationId: doc.querySelector('main[data-conversation]')?.getAttribute('data-conversation') ?? null,
    turns,
    activity,
    scopes:
      settings === null ? null : [...settings.querySelectorAll('[data-scope]')].map((s) => s.textContent),
  };
}

/** IDLE on a page with neither a conversation, an activity list nor a settings list; else OK. */
function chatHealth(doc: Document): HealthCheck {
  const reads =
    doc.querySelector('main[data-conversation]') !== null ||
    doc.querySelector('[data-entry]') !== null ||
    doc.querySelector('[data-settings]') !== null;
  return reads ? { status: 'OK' } : { status: 'IDLE', reasons: ['page.not_agent'] };
}

/** An adapter for the synthetic page, as a vendor's adapter would be written (src/adapters/<vendor>/). */
export function chatAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    id: 'claude.chat',
    agent: 'claude',
    vendor: 'anthropic',
    version: '0.1.0',
    hosts: AGENT_HOSTS.claude,
    health: chatHealth,
    extract: readChatPage,
    ...overrides,
  };
}
