/**
 * The charged total of a receipt, from its labelled total line (sprint_2 2.3; Decisions [2.1/2.4] receipt amount
 * rule). A total is an amount on a line that names it: a table row whose first cell is the label (`Order Total:`)
 * and whose other cells hold exactly one amount, or a one-cell line that reads `<label>[:] <amount>`. Labels are
 * matched whole (after ASCII lowercasing, collapsing white space and dropping a trailing colon), so `Subtotal`,
 * `Total due` and `Total savings` are not `Total`. An amount is read by `normalize.amount` to exact integer minor
 * units; text around it (`Visa ••••5556 $23.84`, `at $20.00/month`) makes the line no total at all.
 *
 * Labels are tried in the caller's order of preference (`Amount paid` before `Total`); among the lines with the
 * most preferred label found, every amount must agree, or the total is `ambiguous` and nothing is guessed
 * (Hard Rule 5). Only the amounts leave this module: no line text is kept (Hard Rule 2).
 */
import { amount, asciiLower, type CurrencyCode, type Money } from '../../../core/normalize';
import { oneLine } from '../../text';
import type { Line } from './message';

export type Total =
  | { readonly kind: 'found'; readonly money: Money }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' };

/** A label as it is compared: one line, ASCII-lowercased, without a trailing colon. */
export function labelKey(text: string): string {
  return asciiLower(oneLine(text)).replace(/\s*[:：]$/u, '');
}

interface Hit {
  readonly rank: number;
  readonly money: Money;
}

function rowHit(cells: readonly string[], keys: readonly string[], dollar: CurrencyCode): Hit | null {
  const [label = '', ...rest] = cells;
  const rank = keys.indexOf(labelKey(label));
  if (rank < 0) return null;
  const money = amount(rest.filter((cell) => cell !== '').join(' '), { defaultDollar: dollar });
  return money === null ? null : { rank, money };
}

/** `<label>[:] <amount>` in one run of text; the most preferred label whose remainder is exactly an amount. */
function runHit(text: string, keys: readonly string[], dollar: CurrencyCode): Hit | null {
  const lower = asciiLower(text);
  for (const [rank, key] of keys.entries()) {
    if (key === '' || !lower.startsWith(key)) continue;
    // After the label: an optional colon and spaces, then exactly one amount. A label glued to its amount
    // (`<span>Total</span><span>$23.84</span>`, spaced by CSS) still reads; `Totally $5` does not, because
    // `ly $5` is not an amount.
    const value = /^\s*[:：]?\s*(.*)$/u.exec(text.slice(key.length))?.[1];
    const money = value === undefined ? null : amount(value, { defaultDollar: dollar });
    if (money !== null) return { rank, money };
  }
  return null;
}

function hitOf(line: Line, keys: readonly string[], dollar: CurrencyCode): Hit | null {
  if (line.cells.length >= 2) return rowHit(line.cells, keys, dollar);
  return runHit(line.cells[0] ?? '', keys, dollar);
}

const sameMoney = (a: Money, b: Money): boolean => a.minor === b.minor && a.currency === b.currency;

/**
 * The total named by the most preferred of `labels` that appears on a total line of `lines`. A bare `$` means
 * `dollar`. `missing` when no line names one; `ambiguous` when lines with that label disagree.
 */
export function findTotal(lines: Iterable<Line>, labels: readonly string[], dollar: CurrencyCode): Total {
  const keys = labels.map(labelKey);
  let rank = keys.length;
  let found: Money[] = [];
  for (const line of lines) {
    const hit = hitOf(line, keys, dollar);
    if (hit === null || hit.rank > rank) continue;
    if (hit.rank < rank) {
      rank = hit.rank;
      found = [];
    }
    found.push(hit.money);
  }
  const [first, ...rest] = found;
  if (first === undefined) return { kind: 'missing' };
  return rest.every((money) => sameMoney(money, first))
    ? { kind: 'found', money: first }
    : { kind: 'ambiguous' };
}
