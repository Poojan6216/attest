/**
 * extract() of the Gmail receipt observer (sprint_2 2.3): one raw row per expanded message a parser claims as a
 * receipt, holding only `merchant`, `amountCents`, `currency`, `subjectHint` and `occurredAt` (the gmail.receipt
 * allowlist, policy/default.json); `redact.project` keeps exactly those (Hard Rule 2). The row key is Gmail's
 * message id, so the same receipt read twice is one observation (docs/grading.md §10).
 *
 * occurredAt is when the message was sent: its date (`title`, else `alt`, else the visible text), resolved by
 * `normalize.resolveRelative` against the pass instant in the browser's zone (agents/adapter_engineer.md rule 7),
 * never a date in the body. A date that does not name one minute (none, or a clock time a DST change makes
 * ambiguous) throws `ReceiptError('time_unresolved')`: the pass is DEGRADED and no time is guessed (Hard Rule 5).
 *
 * `receiptWindows` is the observer's coverage (./index.ts): one window per parsed receipt, the single instant of
 * that message (its occurredAt), and none where nothing was parsed.
 */
import { resolveRelative } from '../../../core/normalize';
import type { ExtractContext, RawRow, VisibleWindow } from '../../types';
import { classify } from './classify';
import { ReceiptError } from './errors';
import { type MessageView, readPage } from './message';
import type { ReceiptFacts } from './parser';

/** Gmail's placeholder for an empty subject is interface text, not a subject (Decisions [2.1/2.4]). */
const NO_SUBJECT = '(no subject)';

function occurredAt(message: MessageView, ctx: ExtractContext): string {
  const time = resolveRelative(message.dateText, { referenceIso: ctx.observedAt, offsetAt: ctx.offsetAt });
  if (time?.precision !== 'minute') throw new ReceiptError('time_unresolved');
  return time.start;
}

function fieldsOf(message: MessageView, facts: ReceiptFacts, at: string): object {
  const subject = message.subject === NO_SUBJECT ? '' : message.subject;
  return {
    ...(facts.merchant === undefined ? {} : { merchant: facts.merchant }),
    ...(facts.money === undefined ? {} : { amountCents: facts.money.minor, currency: facts.money.currency }),
    ...(subject === '' ? {} : { subjectHint: subject }),
    occurredAt: at,
  };
}

export function extractReceipts(doc: Document, ctx: ExtractContext): RawRow[] {
  const page = readPage(doc);
  return page.messages.flatMap((message): RawRow[] => {
    const verdict = classify(message, page.account);
    if (verdict.kind !== 'receipt') return [];
    const at = occurredAt(message, ctx);
    return [
      {
        type: verdict.facts.type,
        rowKey: message.key === '' ? undefined : message.key,
        fields: fieldsOf(message, verdict.facts, at),
      },
    ];
  });
}

/**
 * `Observer.visibleWindows`: the instant of each message a parser claimed as a receipt, as a window of its own
 * (`windowStart = windowEnd`), each once. It asserts only that that message was read (sprint_2 2.7; Hard Rule 5).
 * A list view, or a conversation with no receipt in it, asserts none (OK by design).
 */
export function receiptWindows(doc: Document, ctx: ExtractContext): VisibleWindow[] {
  const page = readPage(doc);
  const instants = new Set<string>();
  for (const message of page.messages) {
    if (classify(message, page.account).kind === 'receipt') instants.add(occurredAt(message, ctx));
  }
  return [...instants].map((at) => ({ windowStart: at, windowEnd: at }));
}
