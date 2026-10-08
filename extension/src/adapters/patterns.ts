/**
 * Claim patterns (sprint_3 3.0; agents/adapter_engineer.md rule 9; build_spec §7): the sentences an agent uses to say
 * it acted, as tables of regular expressions per vendor and ActionType, each with the `extractor.confidence` its
 * matches get.
 *
 * Rules first, never a guessed type (Hard Rule 5). `classify(agent, sentence)` holds one sentence of an agent turn,
 * or one activity entry, against the vendor's table (./pattern-tables.ts):
 *  - a sentence that asks, offers, plans or drafts ("Should I send…", "I'll create…", "Here's a draft…") proposes an
 *    action: when it names one, it is `other` at PROPOSAL_CONFIDENCE (how a Muse approval prompt is captured,
 *    sprint_3 3.2), and otherwise it is no claim;
 *  - a sentence that refuses, or reports a step still under way ("I couldn't…", "Sending email…"), is no claim: the
 *    agent says it has not acted (the finished step reports itself);
 *  - else it is held to every pattern: patterns of one type give that type, at the best of their confidences, with
 *    what they captured (counterparty, subject, amount; the first capture of each wins); patterns of two types give
 *    `other` at AMBIGUOUS_CONFIDENCE;
 *  - a sentence that matches none but says it acted without saying how ("Done, all taken care of") is `other` at
 *    VAGUE_CONFIDENCE; any other sentence is no claim.
 * Every `other` is at most 0.4 (sprint_3 3.0). The two mistakes are not alike: a sentence wrongly read as an action
 * can end in a NOT_FOUND that accuses the agent, so anything that reads as not done is never an action.
 *
 * Page text is data (rule 6): it is only ever matched against these fixed tables. A sentence longer than
 * MAX_SENTENCE code units is no claim, and every pattern is a bounded scan without nested quantifiers, so page text
 * cannot make a pass slow (sprint_6 red team).
 *
 * Pure: no DOM, no clock. A helper of the adapter skeleton (eslint-rules/fences.js HELPER_SCOPES).
 */
import type { ActionType, AgentId } from '../core/schema';
import { CLAIM_PATTERNS, type ClaimPattern, re } from './pattern-tables';

export { CLAIM_PATTERNS, type ClaimPattern } from './pattern-tables';

/** A sentence that proposes an action or asks for approval to take it, and names it. */
export const PROPOSAL_CONFIDENCE = 0.2;
/** A sentence that says the agent acted without saying what it did. */
export const VAGUE_CONFIDENCE = 0.3;
/** A sentence that patterns of two types match. */
export const AMBIGUOUS_CONFIDENCE = 0.4;
/** The longest sentence `classify` reads; a longer one is no claim. */
export const MAX_SENTENCE = 400;

/** What `classify` read from one sentence. Captures are the sentence's own text, cut but not cleaned. */
export interface Classified {
  readonly type: ActionType;
  readonly confidence: number;
  readonly counterparty?: string;
  readonly subject?: string;
  readonly amount?: string;
}

// ── Not done ────────────────────────────────────────────────────────────────────────────────────────

/** Verbs of the actions an agent may take, in the forms a proposal or a refusal uses. */
const VERB = String.raw`(?:send|email|e-mail|forward|reply|message|text|create|schedule|book|add|invite|move|reschedule|update|change|cancel|delete|remove|buy|purchase|order|pay|subscribe|unsubscribe|renew|upgrade|downgrade|post|list|set up|put)`;

/** A sentence that asks, offers, plans or drafts: an action proposed, none taken. */
const PROPOSAL: readonly RegExp[] = [
  re(String.raw`\?["')\]]*$`),
  re(String.raw`\b(?:shall|should) (?:i|we)\b`),
  re(String.raw`\b(?:would|do) you (?:like|want)\b|\byou'd like\b|\blet me know if\b`),
  re(String.raw`\bwant me to\b`),
  re(
    String.raw`\b(?:please confirm|confirm (?:that|if|whether)|ready to|needs? your (?:ok|okay|approval|go-ahead))\b`,
  ),
  re(
    String.raw`\b(?:i|we)(?:'ll| will| can| could| would|'d| am going to|'m going to| are going to| plan to| intend to)(?: also| now| then| go ahead and| be happy to| like to){0,2} ${VERB}\b`,
  ),
  re(String.raw`\blet me ${VERB}\b`),
  re(String.raw`\bdraft(?:s|ed|ing)?\b`),
];

/** A sentence that refuses, or reports a step still under way: the agent says it has not acted. */
const NOT_TAKEN: readonly RegExp[] = [
  re(
    String.raw`\b(?:didn't|did not|couldn't|could not|can't|cannot|wasn't able|was not able|unable to|failed to|haven't|have not|hasn't|has not|won't|will not|not yet)\b`,
  ),
  re(String.raw`\b(?:nothing|none) (?:was|were|has been|have been|got)\b`),
  re(
    String.raw`^\W{0,3}(?:sending|emailing|forwarding|replying|messaging|texting|creating|scheduling|booking|adding|inviting|moving|rescheduling|updating|changing|cancell?ing|deleting|removing|buying|purchasing|ordering|paying|subscribing|unsubscribing|posting|listing)\b`,
  ),
];

/**
 * Names an action: a verb of one (an email in "an email from Sam" is a noun, and proposes nothing), or a draft. A
 * proposal that names one is `other`; one that does not is no claim.
 */
const NAMES_ACTION = re(
  String.raw`\bdraft(?:s|ed|ing)?\b|(?<!\b(?:an?|the|this|that|your|my|his|her|their|our|any|no) )\b(?:send|sent|e-?mail(?:ed|ing)?|forward(?:ed|ing)?|repl(?:y|ied|ying)|messag(?:e|ed|ing)|text(?:ed|ing)|creat(?:e|ed|ing)|schedul(?:e|ed|ing)|book(?:ed|ing)?|add(?:ed|ing)?|invit(?:e|ed|ing)|mov(?:e|ed|ing)|reschedul(?:e|ed|ing)|cancell?(?:ed|ing)?|delet(?:e|ed|ing)|remov(?:e|ed|ing)|buy(?:ing)?|bought|purchas(?:e|ed|ing)|order(?:ed|ing)?|plac(?:e|ed|ing)|pa(?:y|id|ying)|(?:un)?subscrib(?:e|ed|ing)|renew(?:ed|ing)?|upgrad(?:e|ed|ing)|downgrad(?:e|ed|ing)|post(?:ed|ing)?|list(?:ed|ing))\b`,
);

/**
 * The past tense of the actions, as a report says it did one: those of the ActionTypes, and others an agent takes
 * (an RSVP, a share, a sign-up), which are `other`.
 */
const DID = String.raw`(?:sent|emailed|forwarded|replied|messaged|texted|created|scheduled|booked|added|invited|moved|rescheduled|updated|changed|cancell?ed|deleted|removed|bought|purchased|ordered|paid|subscribed|unsubscribed|renewed|upgraded|downgraded|posted|listed|declined|accepted|shared|signed (?:\S{1,10} )?up|registered|rsvp'?e?d)`;

/**
 * Says it acted without saying how: in words, in the first person, as an activity entry that starts with it, or
 * in the passive ("Your note has been sent": by what, the sentence does not say).
 */
const VAGUE: readonly RegExp[] = [
  re(String.raw`\b(?:done|all set|taken care of|completed|finished|handled|went ahead and)\b`),
  re(String.raw`\b(?:i|we)(?:'ve| have)?(?: just| already| now){0,2} ${DID}\b`),
  re(String.raw`^\W{0,3}${DID}\b`),
  re(String.raw`\b(?:was|were|has been|have been) ${DID}\b`),
];

/** Muse's approval cards: a step waiting for the user is proposed, never taken. */
const MUSE_PROPOSAL: readonly RegExp[] = [
  re(String.raw`\b(?:approve|tap approve|awaiting (?:your )?approval)\b`),
];

const PROPOSAL_BY_AGENT: Readonly<Record<AgentId, readonly RegExp[]>> = Object.freeze({
  muse: Object.freeze([...PROPOSAL, ...MUSE_PROPOSAL]),
  chatgpt: PROPOSAL,
  dots: PROPOSAL,
  claude: PROPOSAL,
});

// ── Classification ──────────────────────────────────────────────────────────────────────────────────

/** Curly quotes and apostrophes as their ASCII forms, so one pattern reads both. */
function straightQuotes(sentence: string): string {
  return sentence.replace(/[‘’ʼ]/gu, "'").replace(/[“”]/gu, '"');
}

/** The first quoted run of the sentence: an event's or an item's name, when the agent quotes it. */
const QUOTED = /"(?<subject>[^"]{1,120})"/u;

/** The matches of one type: the best confidence and the first capture of each field. */
interface Reading {
  confidence: number;
  counterparty?: string;
  subject?: string;
  amount?: string;
}

function read(pattern: ClaimPattern, sentence: string, into: Map<ActionType, Reading>): void {
  if (pattern.unless?.test(sentence) === true) return;
  const match = pattern.pattern.exec(sentence);
  if (match === null) return;
  const reading = into.get(pattern.type) ?? { confidence: 0 };
  reading.confidence = Math.max(reading.confidence, pattern.confidence);
  const { counterparty, subject, amount } = match.groups ?? {};
  if (reading.counterparty === undefined && counterparty !== undefined) reading.counterparty = counterparty;
  if (reading.subject === undefined && subject !== undefined) reading.subject = subject;
  if (reading.amount === undefined && amount !== undefined) reading.amount = amount;
  into.set(pattern.type, reading);
}

function classified(type: ActionType, reading: Reading, sentence: string): Classified {
  const subject = reading.subject ?? QUOTED.exec(sentence)?.groups?.subject;
  return {
    type,
    confidence: reading.confidence,
    ...(reading.counterparty === undefined ? {} : { counterparty: reading.counterparty }),
    ...(subject === undefined ? {} : { subject }),
    ...(reading.amount === undefined ? {} : { amount: reading.amount }),
  };
}

/**
 * What one sentence of `agent`'s says it did (rules in the module comment), or null when it claims nothing. The
 * sentence is one line (claims.ts splits a turn); a longer one than MAX_SENTENCE is no claim.
 */
export function classify(agent: AgentId, sentence: string): Classified | null {
  if (sentence.length > MAX_SENTENCE) return null;
  const text = straightQuotes(sentence).trim();
  if (text === '') return null;
  if (PROPOSAL_BY_AGENT[agent].some((pattern) => pattern.test(text))) {
    return NAMES_ACTION.test(text) ? { type: 'other', confidence: PROPOSAL_CONFIDENCE } : null;
  }
  if (NOT_TAKEN.some((pattern) => pattern.test(text))) return null;
  const readings = new Map<ActionType, Reading>();
  for (const pattern of CLAIM_PATTERNS[agent]) read(pattern, text, readings);
  const [only, ...more] = readings;
  if (only !== undefined && more.length === 0) return classified(only[0], only[1], text);
  if (only !== undefined) return { type: 'other', confidence: AMBIGUOUS_CONFIDENCE };
  return VAGUE.some((pattern) => pattern.test(text)) ? { type: 'other', confidence: VAGUE_CONFIDENCE } : null;
}
