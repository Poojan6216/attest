/**
 * What the side panel's Add agent activity preview says about a pasted log (sprint_3 3.12; docs/claims-import.md
 * §2): the agent's name, each claim's type, who or what it names and when, and why an entry is not imported. Pure.
 * A claim's time is written from its own ISO text, the wall clock in the person's offset at that instant, so the
 * preview shows the day and time the log said, whatever zone the page runs in.
 */
import type { EntryOutcome } from '../adapters/paste';
import type { ActionType, AgentId, Claim } from '../core/schema';
import { CURRENCY_MINOR_UNITS } from '../core/units';

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

function money(minor: number, currency: string): string {
  const digits = Object.hasOwn(CURRENCY_MINOR_UNITS, currency)
    ? CURRENCY_MINOR_UNITS[currency as keyof typeof CURRENCY_MINOR_UNITS]
    : 2;
  const format = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return format.format(minor / 10 ** digits);
}

/** Who or what a claim names: its counterparty or subject hint, then its amount; null when it names none. */
export function claimWhat(claim: Claim): string | null {
  const named = claim.counterparty ?? claim.subjectHint ?? null;
  const amount =
    claim.amountCents !== undefined && claim.currency !== undefined
      ? money(claim.amountCents, claim.currency)
      : null;
  if (named !== null && amount !== null) return `${named}, ${amount}`;
  return named ?? amount;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WALL_CLOCK = /^(?<y>\d{4})-(?<mo>\d{2})-(?<d>\d{2})T(?<h>\d{2}):(?<mi>\d{2})/u;

const clock12 = (hour: number, minute: number): string =>
  `${String(hour % 12 === 0 ? 12 : hour % 12)}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;

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
