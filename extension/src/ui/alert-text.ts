/**
 * What an alert says (sprint_4 4.6; agents/ux_engineer.md copy rules: grades are nouns, no exclamation marks, and an
 * UNASKED receipt always says "likely", Hard Rule 7). The title names the grade and the agent; the line names the
 * action and its time, and never a counterparty, an amount or a subject: a notification can show on a locked screen.
 * The receipt itself, one click away, holds the rest. Pure.
 */
import type { ActionType } from '../core/schema';
import type { AlertToShow } from '../ledger/alerts';
import { clockTime } from './format';
import { AGENT_NAMES } from './labels';
import { gradeLabel } from './receipt-labels';

export interface AlertText {
  readonly title: string;
  readonly message: string;
}

/** What an agent said it did, in the past tense. */
const DID: Readonly<Record<ActionType, string>> = Object.freeze({
  'email.sent': 'sent an email',
  'calendar.created': 'created a calendar event',
  'calendar.updated': 'changed a calendar event',
  'calendar.deleted': 'cancelled a calendar event',
  'purchase.made': 'made a purchase',
  'subscription.changed': 'changed a subscription',
  'listing.posted': 'posted a listing',
  'message.sent': 'sent a message',
  other: 'did something',
});

/** An action Attest saw that nobody reported, as a noun phrase. */
const SEEN: Readonly<Record<ActionType, string>> = Object.freeze({
  'email.sent': 'An email was sent',
  'calendar.created': 'A calendar event was created',
  'calendar.updated': 'A calendar event was changed',
  'calendar.deleted': 'A calendar event was cancelled',
  'purchase.made': 'A purchase was made',
  'subscription.changed': 'A subscription was changed',
  'listing.posted': 'A listing was posted',
  'message.sent': 'A message was sent',
  other: 'Something was done',
});

/** The one notice for a burst of `count` alerts (TECH-12): how many receipts need a look, and where to see them. */
export function alertBurstText(count: number): AlertText {
  return {
    title: `${String(count)} receipts need a look`,
    message: 'Each ended Not found, Unasked or Over scope. Open the timeline to see them.',
  };
}

/** The alert's title and line, the times written on the clock `nowMs` reads (`clockTime`). */
export function alertText({ agent, grade, action }: AlertToShow, nowMs: number): AlertText {
  const name = AGENT_NAMES[agent];
  const at = action === undefined ? '' : ` at ${clockTime(action.at, nowMs)}`;
  switch (grade) {
    case 'NOT_FOUND':
      return {
        title: `${gradeLabel(grade)}: ${name}`,
        message:
          action === undefined
            ? `${name} said it acted, and Attest found no sign of it.`
            : `${name} said it ${DID[action.type]}${at}. Attest found no sign of it.`,
      };
    case 'UNASKED':
      return {
        title: `${gradeLabel(grade)}: likely ${name}`,
        message:
          action === undefined
            ? `Attest saw an action no agent reported. Likely ${name}.`
            : `${SEEN[action.type]}${at} that no agent reported. Likely ${name}.`,
      };
    case 'OVER_SCOPE':
      return {
        title: `${gradeLabel(grade)}: ${name}`,
        message:
          action === undefined
            ? `${name} holds access you did not declare in its grant.`
            : `${name} said it ${DID[action.type]}${at}, beyond what its grant allows.`,
      };
  }
}
