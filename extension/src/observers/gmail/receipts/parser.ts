/**
 * The receipt-parser contract and the one engine every platform parser runs (sprint_2 2.3).
 *
 * A parser looks at one opened message and answers:
 *  - `receipt`: the facts it read (type, merchant, amount), and nothing else: no body text (Hard Rule 2);
 *  - `none`: not a receipt this parser knows (a shipping notice, a promotion, a plain reservation). Normal mail:
 *    nothing is wrong, nothing is reported;
 *  - `unreadable`: the message IS a receipt by its sender and subject, but the amount line the parser needs is not
 *    where it should be, or reads two ways. The pass is DEGRADED with the reason (Hard Rule 6), and no amount is
 *    guessed (Hard Rule 5).
 *
 * A platform parser (./stripe.ts … ./shopify.ts) is data: its sender domains, subject kinds, total labels and
 * merchant rule live in ./selectors.json. A kind matches on the subject (and not its `exclude`); its amount is the
 * total line with the most preferred label (./amounts.ts) or, for a kind whose subject names an `item` (a
 * Marketplace listing), the row labelled with that item. The merchant is the platform's canonical name, the
 * sender's display name, or the name the subject gives (`merchant` group), as the receipt-merchant rule says
 * (Decisions [2.1/2.4]).
 */
import type { Money } from '../../../core/normalize';
import { oneLine } from '../../text';
import { findTotal } from './amounts';
import type { MessageView } from './message';
import {
  type Kind,
  type ParserId,
  type Platform,
  type PlatformId,
  RECEIPT_SELECTORS,
  type ReceiptType,
} from './selectors';

/** What a parser read from a receipt. Only these facts ever leave the parser. */
export interface ReceiptFacts {
  readonly parser: ParserId;
  readonly type: ReceiptType;
  readonly merchant?: string;
  readonly money?: Money;
  /**
   * The parser's declared prior (the generic parser's 0.6, sprint_2 2.3). Observation has no confidence field, so
   * it is never sent or stored: tests and the bench report it (Decisions [2.3]).
   */
  readonly confidence?: number;
}

/** Health reason codes a parser can give (HEALTH_REASON shape). */
export const UNREADABLE_REASONS = ['receipt.amount_missing', 'receipt.amount_ambiguous'] as const;
export type UnreadableReason = (typeof UNREADABLE_REASONS)[number];

export type Verdict =
  | { readonly kind: 'receipt'; readonly facts: ReceiptFacts }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: UnreadableReason };

export interface ReceiptParser {
  readonly id: ParserId;
  readonly parse: (message: MessageView) => Verdict;
}

export const NOT_A_RECEIPT: Verdict = Object.freeze({ kind: 'none' });

export function unreadable(reason: UnreadableReason): Verdict {
  return { kind: 'unreadable', reason };
}

/** A receipt verdict; optional facts that are undefined are left out (exact optional properties). */
export function receipt(
  parser: ParserId,
  type: ReceiptType,
  parts: { merchant?: string | undefined; money?: Money | undefined; confidence?: number | undefined },
): Verdict {
  const facts: ReceiptFacts = {
    parser,
    type,
    ...(parts.merchant === undefined || parts.merchant === '' ? {} : { merchant: parts.merchant }),
    ...(parts.money === undefined ? {} : { money: parts.money }),
    ...(parts.confidence === undefined ? {} : { confidence: parts.confidence }),
  };
  return { kind: 'receipt', facts };
}

function merchantOf(platform: Platform, message: MessageView, match: RegExpExecArray): string | undefined {
  const rule = platform.merchant;
  if ('canonical' in rule) return rule.canonical;
  if (rule.from === 'senderName') return message.senderName;
  return oneLine(match.groups?.merchant ?? '');
}

function verdictFor(platform: Platform, kind: Kind, match: RegExpExecArray, message: MessageView): Verdict {
  const item = match.groups?.item;
  const labels = item === undefined ? kind.labels : [item, ...kind.labels];
  const total = findTotal(message.lines(), labels, platform.defaultDollar);
  if (total.kind === 'ambiguous') return unreadable('receipt.amount_ambiguous');
  if (total.kind === 'missing' && kind.amount === 'required') return unreadable('receipt.amount_missing');
  return receipt(platform.id, kind.type, {
    merchant: merchantOf(platform, message, match),
    money: total.kind === 'found' ? total.money : undefined,
  });
}

/** The first kind whose subject matches (and whose `exclude` does not) decides; no kind: not a receipt. */
function parsePlatform(platform: Platform, message: MessageView): Verdict {
  for (const kind of platform.kinds) {
    const match = kind.subject.exec(message.subject);
    if (match === null || kind.exclude?.test(message.subject) === true) continue;
    return verdictFor(platform, kind, match, message);
  }
  return NOT_A_RECEIPT;
}

/** The parser for one platform of the registry, driven by its entry in ./selectors.json. */
export function platformParser(id: PlatformId): ReceiptParser {
  const platform = RECEIPT_SELECTORS.platforms[id];
  return Object.freeze({ id, parse: (message: MessageView) => parsePlatform(platform, message) });
}
