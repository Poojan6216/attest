/**
 * What the popup says after the Gmail auto-check opened Gmail (sprint_4 4.9; src/background/auto-check.ts): when, for
 * whose claims, and why, until that open's window ends. Pure: the caller passes the instant it calls now.
 */
import type { AutoCheckRecord } from '../ledger/auto-check-record';
import type { AgentId } from '../ledger/types';
import { clockTime } from './format';
import { AGENT_NAMES } from './labels';

/** Whether the popup says it: from the open until its window ends (a record later than now says nothing). */
export function autoCheckShown(record: AutoCheckRecord | null, nowMs: number): record is AutoCheckRecord {
  return record !== null && Date.parse(record.at) <= nowMs && nowMs < Date.parse(record.until);
}

/** "Muse", "Muse and Claude", "Muse, ChatGPT and Claude". */
function names(agents: readonly AgentId[]): string {
  const all = agents.map((agent) => AGENT_NAMES[agent]);
  const last = all.at(-1) ?? '';
  return all.length < 2 ? last : `${all.slice(0, -1).join(', ')} and ${last}`;
}

/** The notice (header). */
export function autoCheckText({ at, claims, agents }: AutoCheckRecord, nowMs: number): string {
  const emails = claims === 1 ? 'an email' : `${String(claims)} emails`;
  const says = agents.length === 1 ? 'says it sent' : 'say they sent';
  return (
    `At ${clockTime(at, nowMs)} Attest opened your Gmail Sent folder in a pinned tab, to check ${emails} ` +
    `${names(agents)} ${says}: Attest had not seen the folder since. It only reads the folder. Close the tab ` +
    'whenever you like, or turn this off in Options.'
  );
}
