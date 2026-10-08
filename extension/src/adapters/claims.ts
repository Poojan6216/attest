/**
 * Requests and Claims from one read of an agent page (sprint_3 3.0; docs/grading.md §10; build_spec §7). Pure: the
 * skeleton (./base.ts) hands it the read (./types.ts `AgentRead`) and posts what it returns.
 *
 *  - Each user turn of a conversation is a Request: the SHA-256 of its one-line text (`textHash`), its first
 *    TEXT_HINT code units as a hint, and its time; `id = idFromHash(sha256(canonicalJson({agent, conversationId,
 *    textHash, ts})))` (§10). A page with no conversation id gives no Requests.
 *  - Each sentence of an agent turn (`sourceKind: chat`) and each activity entry (`activity_view`) that ./patterns.ts
 *    reads as a claim is a Claim, linked to the conversation's last Request before it, with `rawHash =
 *    sha256(canonicalJson({agent, sourceKind, rowKeyHash or null, text, claimedAt truncated to its precision unit}))`
 *    and `id = idFromHash(rawHash)` (§10): a sentence re-rendered is one claim, the same words at another time another.
 *  - A turn's time is read from the page: an ISO 8601 instant, written again in the user's offset, or vendor-relative
 *    text resolved against the pass instant in the user's zone (core `resolveRelative`). A turn whose time the page
 *    does not show, shows in a way neither reads, or puts after the pass gives nothing: a claim at a guessed time
 *    could end NOT_FOUND (Hard Rule 5). `untimed` counts the turns that lost a Request or a Claim that way, so the
 *    pass says so (Hard Rule 6).
 *  - A claim's fields come from what its pattern captured: a counterparty (an address, else the capitalised words of a
 *    name), a subject hint (one line, at most SUBJECT_HINT code units), an amount (core `amount`; a bare `$` keeps its
 *    cents and no currency, which the grant's `spendCurrency` reads, §6.1). A calendar claim gets no `targetAt` here:
 *    the event's own time is read by each vendor's adapter (3.2 to 3.4); until then such a claim grades `no_target`.
 *
 * A Request's or a Claim's text never leaves whole (Hard Rule 2): a Request keeps its hash and hint, a Claim its fields.
 */
import { idFromHash } from '../core/base32';
import { hashCanonical, sha256Hex } from '../core/hash';
import { amount, instantMs, isoWithOffset, type OffsetAt, resolveRelative } from '../core/normalize';
import { trailingOffsetMinutes } from '../core/normalize-time';
import {
  type AgentId,
  Claim,
  type ClaimPrecision,
  IsoTs,
  Request,
  SCHEMA_LIMITS,
  type SourceKind,
} from '../core/schema';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../core/units';
import { oneLine } from '../observers/text';
import { type Classified, classify } from './patterns';
import type { AgentRead } from './types';

/** What one read of an agent page gives. */
export interface AgentFacts {
  readonly requests: readonly Request[];
  readonly claims: readonly Claim[];
  /** Turns and entries whose Request or Claim was left out because their time could not be read. */
  readonly untimed: number;
  /** Requests and Claims that failed their schema: a bug, never expected (the pass is DEGRADED). */
  readonly invalid: number;
}

/** What building needs besides the read. */
export interface FactsContext {
  readonly agent: AgentId;
  /** The adapter's id and version: every claim's `extractor`, with its pattern's confidence. */
  readonly extractor: { readonly id: string; readonly version: string };
  /** The pass instant: every claim's `observedAt`, and the reference for vendor-relative times. */
  readonly observedAt: IsoTs;
  readonly offsetAt: OffsetAt;
}

const L = SCHEMA_LIMITS;
const UNIT_MS: Readonly<Record<ClaimPrecision, number>> = {
  minute: MS_PER_MINUTE,
  hour: MS_PER_HOUR,
  day: MS_PER_DAY,
};

/** When a turn was written, as a claim states it (§4.1). */
interface Stated {
  readonly at: IsoTs;
  readonly precision: ClaimPrecision;
  /** `day` precision only: the next local midnight. */
  readonly end?: IsoTs;
}

/** `text`, when it is an ISO 8601 instant with an offset, as the same instant in the user's offset there. */
function inUserOffset(text: string, offsetAt: OffsetAt): IsoTs | null {
  if (!IsoTs.safeParse(text).success) return null;
  const ms = instantMs(text);
  const written = IsoTs.safeParse(isoWithOffset(ms, offsetAt(ms)));
  return written.success ? written.data : null;
}

/** Vendor-relative text ("2:03 PM", "Yesterday") resolved against the pass instant, or null. */
function relative(text: string, ctx: FactsContext): Stated | null {
  const resolved = resolveRelative(text, { referenceIso: ctx.observedAt, offsetAt: ctx.offsetAt });
  if (resolved === null) return null;
  const at = IsoTs.safeParse(resolved.start);
  const end = IsoTs.safeParse(resolved.end);
  if (!at.success || !end.success) return null;
  return resolved.precision === 'day'
    ? { at: at.data, precision: 'day', end: end.data }
    : { at: at.data, precision: resolved.precision };
}

/** The time the page shows for a turn, or null when it shows none, none either reader reads, or one after the pass. */
function statedTime(time: string | null, ctx: FactsContext): Stated | null {
  if (time === null) return null;
  const text = oneLine(time);
  const iso = inUserOffset(text, ctx.offsetAt);
  const stated: Stated | null = iso === null ? relative(text, ctx) : { at: iso, precision: 'minute' };
  return stated !== null && instantMs(stated.at) <= instantMs(ctx.observedAt) ? stated : null;
}

/** §10: the start of the precision unit holding `at`, in `at`'s own offset, seconds written, milliseconds not. */
export function unitStart(at: IsoTs, precision: ClaimPrecision): string {
  const offsetMinutes = trailingOffsetMinutes(at) ?? 0;
  const offsetMs = offsetMinutes * MS_PER_MINUTE;
  const unit = UNIT_MS[precision];
  const local = instantMs(at) + offsetMs;
  return isoWithOffset(local - (((local % unit) + unit) % unit) - offsetMs, offsetMinutes);
}

/** A turn's sentences: its lines, each cut after `.`, `!`, `?` or `…` and the white space that follows. */
export function sentences(text: string): string[] {
  return text
    .split(/[\n\r\u2028\u2029]+/u)
    .flatMap((line) => oneLine(line).split(/(?<=[.!?…])\s+/u))
    .filter((sentence) => sentence !== '');
}

/** The first `max` code units of `text`, never ending inside a surrogate pair (the schemas count code units). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** An email address inside a capture or a sentence (patterns.ts reads the same shape). */
const ADDRESS = /[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,24}/iu;
/** A word of a name: a capital, then letters, marks, apostrophes, dots or hyphens (O'Neil, Jean-Luc). */
const NAME_WORD = /^\p{Lu}[\p{L}\p{M}'.-]*$/u;
/** Capitalised words that are no one's name: days, months, and words a sentence starts with. */
const NOT_A_NAME: ReadonlySet<string> = new Set(
  [
    'monday tuesday wednesday thursday friday saturday sunday today tomorrow tonight yesterday',
    'january february march april may june july august september october november december',
    'i the a an your my our their this that everyone',
  ].flatMap((words) => words.split(' ')),
);

/** The address a claim names, else the capitalised words its capture starts with (a name), else nothing. */
function counterpartyOf(read: Classified, sentence: string): string | undefined {
  const capture = read.counterparty ?? '';
  const address =
    ADDRESS.exec(capture)?.[0] ?? (read.type === 'email.sent' ? ADDRESS.exec(sentence)?.[0] : undefined);
  if (address !== undefined) return address;
  const name: string[] = [];
  for (const word of capture.split(' ')) {
    const bare = word.replace(/(?:'s|\.)$/u, '');
    if (!NAME_WORD.test(bare) || NOT_A_NAME.has(bare.toLowerCase())) break;
    name.push(bare);
  }
  return name.length === 0 ? undefined : cut(name.join(' '), L.COUNTERPARTY);
}

/** The captured subject as one line without its quotes and closing punctuation, cut to SUBJECT_HINT. */
function subjectOf(read: Classified): string | undefined {
  const subject = oneLine(read.subject ?? '').replace(/^["']+|["'.,;:!?]+$/gu, '');
  return subject === '' ? undefined : cut(subject, L.SUBJECT_HINT);
}

/** The captured amount: its currency when the text names one, only its cents behind a bare `$` (Hard Rule 5). */
function moneyOf(read: Classified): { amountCents?: number; currency?: string } {
  if (read.amount === undefined) return {};
  const named = amount(read.amount);
  if (named !== null) return { amountCents: named.minor, currency: named.currency };
  const dollars = amount(read.amount, { defaultDollar: 'USD' });
  return dollars === null ? {} : { amountCents: dollars.minor };
}

/** A Claim's fields for one sentence (`Claim` parses them). */
function claimFields(
  sentence: string,
  read: Classified,
  kind: SourceKind,
  stated: Stated,
  rowKey: string | undefined,
  requestId: string | undefined,
  ctx: FactsContext,
): unknown {
  const text = sentence.normalize('NFC');
  const rawHash = hashCanonical({
    agent: ctx.agent,
    sourceKind: kind,
    rowKeyHash: rowKey === undefined ? null : hashCanonical(rowKey),
    text,
    claimedAt: unitStart(stated.at, stated.precision),
  });
  const counterparty = counterpartyOf(read, sentence);
  const subjectHint = subjectOf(read);
  return {
    id: idFromHash(rawHash),
    agent: ctx.agent,
    ...(requestId === undefined ? {} : { requestId }),
    type: read.type,
    ...(counterparty === undefined ? {} : { counterparty }),
    ...moneyOf(read),
    ...(subjectHint === undefined ? {} : { subjectHint }),
    claimedAt: stated.at,
    claimedAtPrecision: stated.precision,
    ...(stated.end === undefined ? {} : { claimedAtEnd: stated.end }),
    observedAt: ctx.observedAt,
    sourceKind: kind,
    extractor: { ...ctx.extractor, confidence: read.confidence },
    rawHash,
  };
}

/** A Request's fields for one user turn (`Request` parses them). */
function requestFields(text: string, stated: Stated, conversationId: string, ctx: FactsContext): unknown {
  const textHash = sha256Hex(text);
  return {
    id: idFromHash(hashCanonical({ agent: ctx.agent, conversationId, textHash, ts: stated.at })),
    agent: ctx.agent,
    conversationId,
    textHint: cut(text, L.TEXT_HINT),
    textHash,
    ts: stated.at,
  };
}

/** The Requests and Claims one read of an agent page holds (rules in the module comment). */
export function buildFacts(read: AgentRead, ctx: FactsContext): AgentFacts {
  const requests = new Map<string, Request>();
  const claims = new Map<string, Claim>();
  let untimed = 0;
  let invalid = 0;
  let requestId: string | undefined;

  /** The claims of one turn or entry: none when it claims nothing, none (and counted) when its time is unread. */
  const addClaims = (
    text: string,
    time: string | null,
    rowKey: string | undefined,
    kind: SourceKind,
  ): void => {
    const found = sentences(text).flatMap((sentence) => {
      const read = classify(ctx.agent, sentence);
      return read === null ? [] : [{ sentence, read }];
    });
    if (found.length === 0) return;
    const stated = statedTime(time, ctx);
    if (stated === null) {
      untimed += 1;
      return;
    }
    for (const { sentence, read } of found) {
      const linked = kind === 'chat' ? requestId : undefined;
      const parsed = Claim.safeParse(claimFields(sentence, read, kind, stated, rowKey, linked, ctx));
      if (parsed.success) claims.set(parsed.data.id, parsed.data);
      else invalid += 1;
    }
  };

  for (const turn of read.turns) {
    if (turn.role === 'agent') {
      addClaims(turn.text, turn.time, turn.rowKey, 'chat');
      continue;
    }
    const text = oneLine(turn.text).normalize('NFC');
    requestId = undefined;
    if (read.conversationId === null || text === '') continue;
    const stated = statedTime(turn.time, ctx);
    if (stated === null) {
      untimed += 1;
      continue;
    }
    const parsed = Request.safeParse(requestFields(text, stated, read.conversationId, ctx));
    if (!parsed.success) {
      invalid += 1;
      continue;
    }
    requests.set(parsed.data.id, parsed.data);
    requestId = parsed.data.id;
  }
  for (const entry of read.activity) addClaims(entry.text, entry.time, entry.rowKey, 'activity_view');
  return { requests: [...requests.values()], claims: [...claims.values()], untimed, invalid };
}
