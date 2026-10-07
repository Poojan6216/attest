/**
 * Card numbers and card endings for the capture sanitiser (capture-pii.ts): a whole card number in groups, and a
 * card's last digits where the text before them says so. Both are faked like a card (Hard Rule 2).
 */
/** 16 digits in groups of 4 (+ up to 3 more), or Amex 4-6-5, with one consistent separator. */
export const CARD = new RegExp(
  String.raw`(?<![\w+@.\-/])(?:\d{4}([ \-])\d{4}\1\d{4}\1\d{4}(?:\1\d{1,3})?|\d{4}([ \-])\d{6}\2\d{5})(?![\w@]|[.\-/]\d)`,
  'g',
);

/** A run of 4 or 5 digits: a card's ending (5 for American Express) is one when the text before it says so. */
export const CARD_TAIL_DIGITS = /(?<!\d)\d{4,5}(?!\d)/gu;
/**
 * What may come right before a card's ending (`Visa ••••4242`, `**** 4242`, `ending in 4242`, `Card ending: 4242`,
 * `Payment method - 4242`, `Visa (4242)`): a mask, "ending" or "last 4", "payment method", or a card brand, then
 * separators. Read only on the 32 characters before each run of digits, so it runs in linear time on any text
 * (security re-review, SEC-R14: a lookbehind over a mask had made a long run of bullets quadratic).
 */
const CARD_TAIL_BEFORE =
  /(?:[•*·●xX]{2,}|…|\bending(?:\s+(?:in|with))?|\bends\s+in|\blast\s+(?:4|four|5|five)(?:\s+digits)?|\bpayment\s+method|\b(?:visa|mastercard|master\s+card|amex|american\s+express|discover|jcb|diners(?:\s+club)?|maestro|unionpay|rupay)\b[^\d\n]{0,12})[\s\u00a0\u202f:#(\-–—]*$/iu;

/** Whether the digits at `index` of `text` are a card's ending (`CARD_TAIL_BEFORE`). */
export const isCardTail = (text: string, index: number): boolean =>
  CARD_TAIL_BEFORE.test(text.slice(Math.max(0, index - 32), index));
