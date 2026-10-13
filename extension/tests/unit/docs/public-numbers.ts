/**
 * The numbers a public text writes (Sprint 7's rule that every number in public traces to RESULTS.md; Sprint 7 close,
 * tech review TECH-2, QA review QA-2), as ./figures.spec.ts reads them to hold each to the metric it quotes
 * (./figures.ts). A number is read however it is written: plain or with a decimal part, grouped ("5,000"), as a
 * percentage, with a unit or a word joined on ("10x", "37ms", "93MB", "a 37-day window"), and as a ratio spelled out
 * ("seven in nine", "six of the thirteen"). Not figures, and so left out: a code span, a link's target, an ordered
 * list's marker, the Chrome version Attest needs, and a date ("Sept 19", "2026-10-13"), as Decisions [7.6] reads them.
 */

const MONTH = String.raw`\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b`;

/** The numbers a ratio may spell out. */
const SPELLED: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};
const WORD = `(${Object.keys(SPELLED).join('|')})`;
const RATIO = new RegExp(String.raw`\b${WORD}\s+(?:in|of|out of)\s+(?:the\s+)?${WORD}\b`, 'giu');
const DIGITS = /(?<![\p{L}\p{N}_.§,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%?)/gu;

/** `text` without what is not a figure (header). */
export function figuresOnly(text: string): string {
  return text
    .replace(/`[^`]*`/gu, '')
    .replace(/\]\([^)]*\)/gu, ']')
    .replace(/^\s*\d+\.\s/gmu, '')
    .replace(/\bChrome \d+/gu, 'Chrome')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/gu, 'a date')
    .replace(new RegExp(MONTH, 'gu'), 'a date');
}

/** The numbers written in `text` (header): `[as written, value, is a percentage]`. */
export function numbersIn(text: string): (readonly [string, number, boolean])[] {
  const prose = figuresOnly(text);
  const written = [...prose.matchAll(DIGITS)].map(
    ([all, whole = '', fraction = '', percent]) =>
      [all, Number(`${whole.replaceAll(',', '')}${fraction}`), percent === '%'] as const,
  );
  const spelled = [...prose.matchAll(RATIO)].flatMap(([all, one = '', two = '']) => [
    [all, SPELLED[one.toLowerCase()] ?? Number.NaN, false] as const,
    [all, SPELLED[two.toLowerCase()] ?? Number.NaN, false] as const,
  ]);
  return [...written, ...spelled];
}
