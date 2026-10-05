/**
 * extract() of the Gmail receipt observer (sprint_2 2.3): one raw row per expanded message a parser claims as a
 * receipt, holding only `merchant`, `amountCents`, `currency`, `subjectHint` and `occurredAt` (the gmail.receipt
 * allowlist, policy/default.json); `redact.project` keeps exactly those (Hard Rule 2). The row key is Gmail's
 * message id, so the same receipt read twice is one observation (docs/grading.md §10).
 *
 * occurredAt is when the message was sent: its date (`title`, else `alt`, else the visible text), resolved by
 * `normalize.resolveRelative` against the pass instant in the browser's zone (agents/adapter_engineer.md rule 7),
 * never a date in the body. A date that does not name one minute (none, or a clock time a DST change makes
 * ambiguous) is never guessed (Hard Rule 5): a platform receipt with one throws `ReceiptError('time_unresolved')`,
 * so the pass is DEGRADED (Hard Rule 6); a generic receipt with one is dropped, because a stranger chooses when
 * their mail arrives and the generic parser never makes a pass DEGRADED (./generic.ts, SEC-V2).
 *
 * `receiptWindows` is the observer's coverage (./index.ts): one window per receipt a platform parser read (a sender
 * of the registry), the single instant of that message (its occurredAt), and none where nothing was parsed. A
 * generic receipt (a sender outside the registry, ./generic.ts) posts no window (SEC-6): anyone can send one, so it
 * is evidence for a claim, never a reason to accuse an agent. A row is an orphan, and so a possible UNASKED, only
 * inside a coverage window of its source (docs/grading.md §3, §7), and no generic receipt lies in one this pass
 * posts: a platform receipt dated in the same minute as a generic one of the same pass posts no window either.
 * Rows carry no parser, so the point of a registry receipt read in the same minute in another pass can still hold
 * a generic one and make it an orphan (a known limit, docs/attacks-that-work.md).
 *
 * Both read the pass's one read of the page and its verdicts (TECH-2).
 */
import { instantMs, resolveRelative } from '../../../core/normalize';
import type { ExtractContext, RawRow, VisibleWindow } from '../../types';
import { verdictsOf } from './classify';
import { ReceiptError } from './errors';
import { type MessageView, pageOf } from './message';
import type { ReceiptFacts } from './parser';
import { RECEIPT_SELECTORS } from './selectors';

/** A message a parser claims as a receipt, what it read, and the minute it was sent. */
interface DatedReceipt {
  readonly message: MessageView;
  readonly facts: ReceiptFacts;
  readonly at: string;
}

/** The minute the message was sent, or null when its date names no single minute. */
function sentMinute(message: MessageView, ctx: ExtractContext): string | null {
  const time = resolveRelative(message.dateText, { referenceIso: ctx.observedAt, offsetAt: ctx.offsetAt });
  return time?.precision === 'minute' ? time.start : null;
}

function fieldsOf({ message, facts, at }: DatedReceipt): object {
  // Gmail's placeholder for an empty subject is interface text, not a subject (Decisions [2.1/2.4]).
  const subject = RECEIPT_SELECTORS.noSubject.has(message.subject) ? '' : message.subject;
  return {
    ...(facts.merchant === undefined ? {} : { merchant: facts.merchant }),
    ...(facts.money === undefined ? {} : { amountCents: facts.money.minor, currency: facts.money.currency }),
    ...(subject === '' ? {} : { subjectHint: subject }),
    occurredAt: at,
  };
}

/** Each message a parser claims as a receipt, with what it read and its minute (header: an undated one). */
function receiptsOf(doc: Document, ctx: ExtractContext): DatedReceipt[] {
  const page = pageOf(doc);
  const verdicts = verdictsOf(page);
  return page.messages.flatMap((message, index): DatedReceipt[] => {
    const verdict = verdicts[index];
    if (verdict?.kind !== 'receipt') return [];
    const at = sentMinute(message, ctx);
    if (at !== null) return [{ message, facts: verdict.facts, at }];
    if (verdict.facts.parser === 'generic') return [];
    throw new ReceiptError('time_unresolved');
  });
}

export function extractReceipts(doc: Document, ctx: ExtractContext): RawRow[] {
  return receiptsOf(doc, ctx).map((dated) => ({
    type: dated.facts.type,
    rowKey: dated.message.key === '' ? undefined : dated.message.key,
    fields: fieldsOf(dated),
  }));
}

/**
 * `Observer.visibleWindows`: the instant of each message a platform parser claimed as a receipt, as a window of its
 * own (`windowStart = windowEnd`), each once, except an instant a generic receipt of the same pass also has (header).
 * It asserts only that that message was read (sprint_2 2.7; Hard Rule 5). A list view, a conversation with no
 * receipt in it, or one with only generic receipts, asserts none (OK by design).
 */
export function receiptWindows(doc: Document, ctx: ExtractContext): VisibleWindow[] {
  const platform = new Map<number, string>();
  const generic = new Set<number>();
  for (const { facts, at } of receiptsOf(doc, ctx)) {
    if (facts.parser === 'generic') generic.add(instantMs(at));
    else if (!platform.has(instantMs(at))) platform.set(instantMs(at), at);
  }
  return [...platform]
    .filter(([ms]) => !generic.has(ms))
    .map(([, at]) => ({ windowStart: at, windowEnd: at }));
}
