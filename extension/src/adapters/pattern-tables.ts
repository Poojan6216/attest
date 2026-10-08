/**
 * The claim pattern tables (sprint_3 3.0; agents/adapter_engineer.md rule 9): per vendor, the past-tense reports and
 * activity entries that say an agent took an action of one ActionType, each with the `extractor.confidence` its
 * matches get. ./patterns.ts `classify` reads a sentence against them, after its rules for proposals, refusals and
 * vague reports. Every pattern is case-insensitive and a bounded scan without nested quantifiers (no page text can
 * make one backtrack for long); `unless` names a reading that makes the sentence some other action.
 *
 * Pure: no DOM, no clock. A helper of the adapter skeleton (eslint-rules/fences.js HELPER_SCOPES).
 */
import { z } from 'zod';

import type { ActionType, AgentId } from '../core/schema';
import levelsJson from './patterns.json';

/** One row of a table: a sentence it matches is an action of `type`, unless `unless` matches it too. */
export interface ClaimPattern {
  readonly type: Exclude<ActionType, 'other'>;
  /** Case-insensitive. May capture `counterparty`, `subject` and `amount`. */
  readonly pattern: RegExp;
  readonly confidence: number;
  /** A reading that makes the sentence some other action (adding a guest to a meeting creates no event). */
  readonly unless?: RegExp;
}

// ── Fragments ───────────────────────────────────────────────────────────────────────────────────────

/** An email address: what a counterparty capture keeps whole. */
const ADDRESS = String.raw`[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,24}`;
/** A counterparty: an address, or up to three words (claims.ts keeps the capitalised ones as a name). */
const PARTY = String.raw`(?<counterparty>${ADDRESS}|[^\s,;:!?()"]{1,60}(?: [^\s,;:!?()"]{1,60}){0,2})`;
/** A number as an amount writes it: digits and separators, ending on a digit (a sentence's full stop is not one). */
const NUMBER = String.raw`\d(?:[\d,.]{0,14}\d)?`;
/** An amount as core `amount()` reads it: a sign or code before or after the number. */
const AMOUNT = String.raw`(?<amount>(?:[$€£¥₹]|(?:US|CA|AU|NZ)\$|(?:USD|EUR|GBP|CAD|AUD|INR|JPY|CHF) ?)${NUMBER}|${NUMBER} ?(?:USD|EUR|GBP|CAD|AUD|INR|JPY|CHF|€|£)(?![a-z]))`;
/** Words for a calendar entry, one or several. */
const EVENT = String.raw`(?:events?|meetings?|appointments?|calls?|invites?|invitations?|reminders?|syncs?|stand-?ups?|1:1s?|one-on-ones?|check-ins?|catch-ups?|interviews?|calendar (?:entry|entries|events?|holds?))`;
/** A meeting's papers and places, which are not the meeting: notes made or deleted change no calendar. */
const EVENT_THING = String.raw`${EVENT} (?:notes|minutes|summary|recap|agenda|doc|document|recording|link|room|folder|slides)\b`;
/** A guest added to, or removed from, an event that already exists (up to three words name it). */
const OF_EVENT = String.raw`(?:to|from) (?:the|your|this|that)(?: \S{1,30}){0,3} ${EVENT}\b`;
/** Chat channels a non-email message goes over. */
const CHANNEL = String.raw`(?:slack|whatsapp|imessage|sms|text|(?:microsoft )?teams|discord|telegram|signal|messenger|linkedin|instagram)`;
/** Marketplaces a listing goes up on. */
const MARKET = String.raw`(?:(?:facebook )?marketplace|craigslist|ebay|etsy|offerup|poshmark|depop|mercari|vinted|kijiji|gumtree)`;

export const re = (source: string): RegExp => new RegExp(source, 'iu');

/**
 * The confidence levels (./patterns.json, data like a receipt parser's prior): each in [0, 1], and every `other` level
 * below every action level. tests/unit/adapters/patterns.spec.ts holds every `other` to the sprint's 0.4 at most. A
 * file that breaks this throws when the content script loads.
 */
const Level = z.number().min(0).max(1);
const Levels = z
  .strictObject({
    note: z.string(),
    confidence: z.strictObject({
      proposal: Level,
      vague: Level,
      ambiguous: Level,
      exact: Level,
      strong: Level,
      plain: Level,
      loose: Level,
      tool: Level,
    }),
  })
  .refine(
    ({ confidence: c }) =>
      Math.max(c.proposal, c.vague, c.ambiguous) < Math.min(c.exact, c.strong, c.plain, c.loose, c.tool),
    { message: 'every action level is above every other level' },
  );

export const LEVEL = Levels.parse(levelsJson).confidence;

// ── The tables ──────────────────────────────────────────────────────────────────────────────────────

/** The patterns every vendor's agents use: plain English past-tense reports and terse activity entries. */
const SHARED: readonly ClaimPattern[] = [
  // email.sent
  {
    type: 'email.sent',
    pattern: re(String.raw`\b(?:sent|forwarded|e-?mailed)\b.{0,80}?\be-?mail\b.{0,60}?\bto ${PARTY}`),
    confidence: LEVEL.exact,
  },
  {
    type: 'email.sent',
    pattern: re(String.raw`\be-?mail (?:was )?sent to ${PARTY}`),
    confidence: LEVEL.exact,
  },
  {
    type: 'email.sent',
    pattern: re(String.raw`\be-?mail\b.{0,60}?\b(?:was|has been) sent\b`),
    confidence: LEVEL.strong,
  },
  {
    // Anything sent or forwarded to an address went by email; an invitation is the calendar's own.
    type: 'email.sent',
    pattern: re(String.raw`\b(?:sent|forwarded)\b.{0,60}?\bto (?<counterparty>${ADDRESS})`),
    confidence: LEVEL.strong,
    unless: re(String.raw`\binvit(?:e|ation)\b`),
  },
  {
    type: 'email.sent',
    pattern: re(String.raw`\bclicked "?send"?\b.{0,60}?\be-?mail\b`),
    confidence: LEVEL.loose,
  },
  {
    type: 'email.sent',
    pattern: re(String.raw`\b(?:sent|e-?mailed|forwarded)(?: an?| the)? (?<counterparty>${ADDRESS})`),
    confidence: LEVEL.strong,
  },
  { type: 'email.sent', pattern: re(String.raw`\be-?mailed ${PARTY}`), confidence: LEVEL.strong },
  {
    type: 'email.sent',
    pattern: re(String.raw`\b(?:replied|responded) to ${PARTY}(?:'s)? (?:e-?mail|mail)\b`),
    confidence: LEVEL.strong,
  },
  {
    type: 'email.sent',
    pattern: re(
      String.raw`\b(?:sent|forwarded)(?: an?| the| your| that| this)?(?: \S{1,30}){0,3} e-?mails?\b`,
    ),
    confidence: LEVEL.loose,
  },
  // calendar.created
  {
    type: 'calendar.created',
    pattern: re(String.raw`\b(?:created|scheduled|set up|set|booked)\b.{0,60}?\b${EVENT}\b`),
    confidence: LEVEL.strong,
    unless: re(String.raw`\b${OF_EVENT}|\b${EVENT_THING}`),
  },
  {
    type: 'calendar.created',
    pattern: re(String.raw`\b(?:added|put|placed)\b.{0,80}?\b(?:to|on|in) (?:your|the|my) calendar\b`),
    confidence: LEVEL.strong,
  },
  {
    type: 'calendar.created',
    pattern: re(String.raw`\badded (?:an?|the|your)(?: new)? ${EVENT}\b`),
    confidence: LEVEL.plain,
  },
  {
    type: 'calendar.created',
    pattern: re(String.raw`\bsent (?:an?|the) (?:calendar )?invit(?:e|ation)\b(?:.{0,40}?\bto ${PARTY})?`),
    confidence: LEVEL.plain,
  },
  {
    type: 'calendar.created',
    pattern: re(String.raw`\b${EVENT}\b.{0,60}?\b(?:was|has been) (?:created|scheduled|added)\b`),
    confidence: LEVEL.strong,
    unless: re(String.raw`\b${EVENT_THING}`),
  },
  // calendar.updated
  {
    type: 'calendar.updated',
    pattern: re(
      String.raw`\b(?:moved|rescheduled|updated|changed|shifted|pushed|renamed|edited|extended|shortened)\b.{0,60}?\b(?:${EVENT}|reservation)\b`,
    ),
    confidence: LEVEL.plain,
    unless: re(String.raw`\b${EVENT_THING}`),
  },
  {
    type: 'calendar.updated',
    pattern: re(String.raw`\b(?:moved|rescheduled|pushed|renamed) "(?<subject>[^"]{1,120})"`),
    confidence: LEVEL.plain,
  },
  {
    type: 'calendar.updated',
    pattern: re(String.raw`\b(?:added|invited|removed) ${PARTY} ${OF_EVENT}`),
    confidence: LEVEL.loose,
  },
  {
    type: 'calendar.updated',
    pattern: re(
      String.raw`\b${EVENT}\b.{0,60}?\b(?:was|has been|is now) (?:moved|rescheduled|updated|changed)\b`,
    ),
    confidence: LEVEL.plain,
    unless: re(String.raw`\b${EVENT_THING}`),
  },
  // calendar.deleted
  {
    type: 'calendar.deleted',
    pattern: re(String.raw`\b(?:deleted|removed|cancell?ed|cleared)\b.{0,60}?\b${EVENT}\b`),
    confidence: LEVEL.strong,
    unless: re(String.raw`\b${OF_EVENT}|\b${EVENT_THING}`),
  },
  {
    type: 'calendar.deleted',
    pattern: re(String.raw`\b${EVENT}\b.{0,60}?\b(?:was|has been) (?:deleted|removed|cancell?ed)\b`),
    confidence: LEVEL.strong,
    unless: re(String.raw`\b${EVENT_THING}`),
  },
  // purchase.made
  {
    type: 'purchase.made',
    pattern: re(
      String.raw`\b(?:bought|purchased|ordered|paid for|checked out|placed (?:an?|the|your) order for)\b (?<subject>.{1,80}?) (?:for|at|from|totall?ing|costing) ${AMOUNT}`,
    ),
    confidence: LEVEL.exact,
  },
  {
    type: 'purchase.made',
    pattern: re(String.raw`\bpaid ${AMOUNT} (?:to|for|at) (?<subject>.{1,80})`),
    confidence: LEVEL.strong,
  },
  { type: 'purchase.made', pattern: re(String.raw`\bpaid\b.{0,60}?${AMOUNT}`), confidence: LEVEL.plain },
  {
    type: 'purchase.made',
    pattern: re(String.raw`\b(?:bought|purchased|ordered)\b (?<subject>.{1,80})`),
    confidence: LEVEL.loose,
  },
  {
    type: 'purchase.made',
    pattern: re(
      String.raw`\bbooked (?:an?|the|your|two|2|three|3)? ?(?:\S{1,20} )?(?:flights?|hotel|room|tickets?|stay|ride|rental car|car rental)\b`,
    ),
    confidence: LEVEL.loose,
  },
  {
    type: 'purchase.made',
    pattern: re(String.raw`\border\b.{0,60}?\b(?:was |has been )?(?:placed|confirmed|submitted)\b`),
    confidence: LEVEL.plain,
  },
  // subscription.changed
  {
    type: 'subscription.changed',
    pattern: re(
      String.raw`\b(?:subscribed|unsubscribed|cancell?ed|upgraded|downgraded|renewed|paused|resumed|changed|switched|updated|ended|started|activated|deactivated|opted out)\b.{0,60}?\b(?:subscriptions?|plan|membership|newsletter|mailing list|tier|trial)\b`,
    ),
    confidence: LEVEL.plain,
  },
  { type: 'subscription.changed', pattern: re(String.raw`\bunsubscribed\b`), confidence: LEVEL.loose },
  {
    type: 'subscription.changed',
    pattern: re(
      String.raw`\b(?:subscription|membership|plan)\b.{0,60}?\b(?:was |has been |is now )?(?:cancell?ed|renewed|upgraded|downgraded|paused|changed|updated)\b`,
    ),
    confidence: LEVEL.plain,
  },
  // listing.posted
  {
    type: 'listing.posted',
    pattern: re(String.raw`\b(?:listed|posted|put up)\b (?<subject>.{1,80}?) (?:on|to) ${MARKET}\b`),
    confidence: LEVEL.strong,
  },
  {
    type: 'listing.posted',
    pattern: re(String.raw`\blisted\b (?<subject>.{1,80}?) for (?:sale\b|${AMOUNT})`),
    confidence: LEVEL.plain,
  },
  {
    type: 'listing.posted',
    pattern: re(String.raw`\b(?:created|posted|published)(?: an?| the| your)?(?: new)? listing\b`),
    confidence: LEVEL.plain,
  },
  {
    type: 'listing.posted',
    pattern: re(
      String.raw`\blisting\b.{0,60}?\b(?:is (?:now )?live|went live|(?:was|has been) (?:posted|published))\b`,
    ),
    confidence: LEVEL.plain,
  },
  // message.sent
  {
    type: 'message.sent',
    pattern: re(
      String.raw`\b(?:sent|messaged|texted|dm'?e?d|pinged|posted|wrote)\b.{0,80}?\b(?:on|via|in|through|over|using|by) ${CHANNEL}\b`,
    ),
    confidence: LEVEL.plain,
  },
  {
    type: 'message.sent',
    pattern: re(String.raw`\b(?:texted|messaged|dm'?e?d) ${PARTY}`),
    confidence: LEVEL.plain,
  },
  {
    type: 'message.sent',
    pattern: re(
      String.raw`\bsent (?<counterparty>[^\s,;:!?()"]{1,60}(?: [^\s,;:!?()"]{1,60})?) an? (?:text|dm|sms|direct message)\b`,
    ),
    confidence: LEVEL.plain,
  },
  {
    type: 'message.sent',
    pattern: re(String.raw`\b${CHANNEL} (?:message|dm|text)\b(?:.{0,40}?\bto ${PARTY})?`),
    confidence: LEVEL.plain,
  },
];

/** Claude reports connector and tool use in the thread ("Sent email via Gmail", a tool named `create_event`). */
const CLAUDE: readonly ClaimPattern[] = [
  {
    // `send_message` alone may be any connector's (Slack names its tool so too): only Gmail's is an email.
    type: 'email.sent',
    pattern: re(String.raw`\bgmail[\W_]{0,3}send_?(?:email|message|mail)\b|\bsend_?(?:email|mail)\b`),
    confidence: LEVEL.tool,
  },
  {
    type: 'message.sent',
    pattern: re(String.raw`\bslack[\W_]{0,3}(?:send|post)_?message\b`),
    confidence: LEVEL.tool,
  },
  {
    type: 'calendar.created',
    pattern: re(String.raw`\b(?:(?:google_?)?calendar[\W_]{0,3})?create_?event\b`),
    confidence: LEVEL.tool,
  },
  {
    type: 'calendar.updated',
    pattern: re(String.raw`\b(?:(?:google_?)?calendar[\W_]{0,3})?update_?event\b`),
    confidence: LEVEL.tool,
  },
  {
    type: 'calendar.deleted',
    pattern: re(String.raw`\b(?:(?:google_?)?calendar[\W_]{0,3})?delete_?event\b`),
    confidence: LEVEL.tool,
  },
];

/** ChatGPT's agent mode and Dots log terse entries in their activity views ("Sent email", "Order placed"). */
const CHATGPT: readonly ClaimPattern[] = [
  { type: 'email.sent', pattern: re(String.raw`^\W{0,3}sent e-?mail\b`), confidence: LEVEL.plain },
  {
    type: 'calendar.created',
    pattern: re(String.raw`^\W{0,3}created (?:calendar )?event\b`),
    confidence: LEVEL.plain,
  },
  {
    type: 'purchase.made',
    pattern: re(String.raw`^\W{0,3}completed (?:the )?(?:purchase|checkout)\b`),
    confidence: LEVEL.plain,
  },
];

/** Muse reports a finished task as "Done!" and asks first with an approval card. */
const MUSE: readonly ClaimPattern[] = [
  {
    type: 'purchase.made',
    pattern: re(String.raw`\byour order (?:is|has been) (?:placed|confirmed)\b`),
    confidence: LEVEL.plain,
  },
];
export const CLAIM_PATTERNS: Readonly<Record<AgentId, readonly ClaimPattern[]>> = Object.freeze({
  muse: Object.freeze([...SHARED, ...MUSE]),
  chatgpt: Object.freeze([...SHARED, ...CHATGPT]),
  dots: Object.freeze([...SHARED, ...CHATGPT]),
  claude: Object.freeze([...SHARED, ...CLAUDE]),
});
