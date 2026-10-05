/**
 * Which parser reads a message, and what it says (sprint_2 2.3: "run only on an opened message whose sender
 * matches the parser's sender list").
 *
 *  - No readable sender address, or a confusable one (a non-ASCII code point or an `xn--` label: a lookalike of a
 *    registry domain): no parser. A lookalike never reaches the generic parser either (Hard Rule 5).
 *  - Mail from the signed-in account itself (a sent thread, a forward of a receipt): no parser. A message you sent
 *    is not a purchase.
 *  - A sender whose domain is in the registry (./selectors.json `platforms.*.senderDomains`): that platform's
 *    parser only. Its other mail (shipping notices, promotions) is never handed to the generic parser.
 *  - Any other sender: the generic parser (./generic.ts).
 * The display name is never used to choose a parser: it is attacker-controlled.
 *
 * `verdictsOf` classifies each message of one page read once: health, the rows, the windows and the bench all ask
 * for the same verdicts in a pass (TECH-2).
 */
import { asciiLower } from '../../../core/normalize';
import { amazon } from './amazon';
import { generic } from './generic';
import { instacart } from './instacart';
import { marketplace } from './marketplace';
import type { MessageView, PageView } from './message';
import { opentable } from './opentable';
import { NOT_A_RECEIPT, type ReceiptParser, type Verdict } from './parser';
import { type ParserId, platformForDomain } from './selectors';
import { shopify } from './shopify';
import { stripe } from './stripe';
import { uber } from './uber';

/** Every parser, by id: the seven platforms of the registry and the generic one. */
export const RECEIPT_PARSERS: Readonly<Record<ParserId, ReceiptParser>> = Object.freeze({
  stripe,
  amazon,
  marketplace,
  opentable,
  instacart,
  uber,
  shopify,
  generic,
});

/** The parser that may read `message`, or null when none may. */
export function parserFor(message: MessageView, account: string | null): ReceiptParser | null {
  const sender = message.sender;
  if (sender === null || sender.confusable) return null;
  if (account !== null && asciiLower(sender.address) === account) return null;
  const platform = platformForDomain(sender.domain);
  return platform === undefined ? generic : RECEIPT_PARSERS[platform.id];
}

/** What the parser that may read `message` says about it. */
export function classify(message: MessageView, account: string | null): Verdict {
  return parserFor(message, account)?.parse(message) ?? NOT_A_RECEIPT;
}

/** Each page read's verdicts, one per message, in order. */
const VERDICTS = new WeakMap<PageView, readonly Verdict[]>();

/** The verdict on each message of `page`, in order, classified once per page read. */
export function verdictsOf(page: PageView): readonly Verdict[] {
  const known = VERDICTS.get(page);
  if (known !== undefined) return known;
  const verdicts = page.messages.map((message) => classify(message, page.account));
  VERDICTS.set(page, verdicts);
  return verdicts;
}
