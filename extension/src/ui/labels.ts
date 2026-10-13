/**
 * The words every surface names an agent and a claim with (named for the paste preview it began in, sprint_3 3.12;
 * renamed in the Sprint 4 close, tech review TECH-8, since the popup, the side panel, the digest, the shares and the
 * service worker's alerts read it too): the agent's name, each claim's type, who or what it names and when, a count,
 * and why a pasted entry is not imported (docs/claims-import.md §2). Pure. A claim's time is written from its own ISO
 * text, the wall clock in the person's offset at that instant, so the preview shows the day and time the log said,
 * whatever zone the page runs in.
 */
import type { EntryOutcome } from '../adapters/paste';
import { MONTHS, twoDigits, WEEKDAYS } from '../core/calendar-words';
import type { ActionType, AgentId, Claim } from '../core/schema';
import { HOURS_PER_HALF_DAY } from '../core/units';
import { formatAmount } from './format';

export const AGENT_NAMES: Readonly<Record<AgentId, string>> = Object.freeze({
  muse: 'Muse',
  chatgpt: 'ChatGPT',
  dots: 'Dots',
  claude: 'Claude',
});

/** The agents in the picker's order. */
export const AGENT_ORDER: readonly AgentId[] = Object.freeze(['muse', 'chatgpt', 'dots', 'claude']);

const TYPE_LABELS: Readonly<Record<ActionType, string>> = Object.freeze({
  'email.sent': 'Email sent',
  'calendar.created': 'Event created',
  'calendar.updated': 'Event changed',
  'calendar.deleted': 'Event cancelled',
  'purchase.made': 'Purchase',
  'subscription.changed': 'Subscription changed',
  'listing.posted': 'Listing posted',
  'message.sent': 'Message sent',
  other: 'Other: a proposal or an unclear report',
});

export const claimTypeLabel = (type: ActionType): string => TYPE_LABELS[type];

/** "1 claim", "3 claims". */
export const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** Who or what a claim names: its counterparty or subject hint, then its amount; null when it names none. */
export function claimWhat(claim: Claim): string | null {
  const named = claim.counterparty ?? claim.subjectHint ?? null;
  const amount = claim.amountCents === undefined ? null : formatAmount(claim.amountCents, claim.currency);
  if (named !== null && amount !== null) return `${named}, ${amount}`;
  return named ?? amount;
}

const WALL_CLOCK = /^(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})T(?<h>\d{2}):(?<mi>\d{2})/u;

const clock12 = (hour: number, minute: number): string => {
  const twelve = hour % HOURS_PER_HALF_DAY === 0 ? HOURS_PER_HALF_DAY : hour % HOURS_PER_HALF_DAY;
  return `${String(twelve)}:${twoDigits(minute)} ${hour < HOURS_PER_HALF_DAY ? 'am' : 'pm'}`;
};

/** When a claim says it happened, on the person's clock: "Thu 8 Oct, 4:33 pm"; a whole day or hour says so. */
export function claimWhen(claim: Claim): string {
  const g = WALL_CLOCK.exec(claim.claimedAt)?.groups;
  if (g === undefined) return claim.claimedAt;
  const [y, mo, d, h, mi] = [g.y, g.mo, g.d, g.h, g.mi].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] ?? '';
  const day = `${weekday} ${String(d)} ${MONTHS[mo - 1] ?? ''}`;
  if (claim.claimedAtPrecision === 'day') return `${day}, time not shown`;
  if (claim.claimedAtPrecision === 'hour') return `${day}, the hour from ${clock12(h, mi)}`;
  return `${day}, ${clock12(h, mi)}`;
}

const SKIPPED_REASONS: Readonly<Record<Exclude<EntryOutcome, 'claim'>, string>> = Object.freeze({
  no_day: 'Not imported: no day. Copy the day heading, such as “Today”, with the entries.',
  no_time: 'Not imported: no time Attest can use.',
  no_claim: 'Nothing Attest checks.',
  invalid: 'Not imported: Attest could not read this entry.',
});

/** What the preview says of the entry times a log keeps (security review SEC-4): the minutes, never the text. */
export const keptTimes = (minutes: number, agent: AgentId): string =>
  `It also keeps the times of ${count(minutes, 'entry', 'entries')}, as times ${AGENT_NAMES[agent]} was working.`;

/** What the preview says of one entry that is no claim but whose time is kept. */
export const keptTime = (agent: AgentId): string =>
  `Its time is kept as a time ${AGENT_NAMES[agent]} was working.`;

/** Why an entry gives no claim, in the preview's words. */
export const skippedReason = (outcome: Exclude<EntryOutcome, 'claim'>): string => SKIPPED_REASONS[outcome];

/**
 * An entry's lines on one line, cut to `max` characters with an ellipsis, so the person can tell which it is. It is
 * cut between characters (code points), never inside a surrogate pair, which would show as a replacement character
 * (Sprint 3 QA review GAP 8).
 */
export function excerpt(text: string, max = 120): string {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' · ');
  const characters = Array.from(line);
  return characters.length <= max
    ? line
    : `${characters
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * What an Unasked receipt can and cannot catch (sprint_6 6.9; Decisions [6.9]), worded from the rule as the red team
 * measured it (Sprint 6 close, security review SEC-8, tech review TECH-3; docs/attacks-that-work.md, strategy 10): a
 * send is flagged only where two different signs met near it, the agent's pasted log active then together with
 * another kind of action it claimed then (4 of 4), or with the person away (3 of 3). Every send with one sign or none
 * was missed, 12 of the 18 of them with the agent active within ten minutes: one logged or claimed action, two logged
 * ones (one sign), a send it claims beside it. So where a person could read no Unasked receipt as no unasked action,
 * the side panel's grade filter and the weekly digest say this.
 */
export const UNASKED_LIMIT =
  'Attest marks a send as likely Unasked only when two different signs meet near it: your agent’s pasted log shows it active then, and it claimed another kind of action then, or you were away. One sign near a send, or none, is not enough, so many sends an agent makes without claiming them are never flagged.';
