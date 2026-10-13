/**
 * Sprint 7's rule that every number in public traces to RESULTS.md (sprints/sprint_7.md; agents/docs_writer.md rule 1,
 * agents/launch_engineer.md rule 1), as the README's and the launch kit's tests check it (./readme.spec.ts,
 * ./launch-kit.spec.ts): every number written must be a value RESULTS.md holds, a percentage a fraction there. A code
 * span, a link's target, a Chrome version Attest needs and a date ("Sept 19") are not figures, and are left out.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const RESULTS = readFileSync(path.join(REPO_ROOT, 'RESULTS.md'), 'utf8');

/** Every value RESULTS.md's tables hold that is a number. */
export const RESULT_VALUES: readonly number[] = [...RESULTS.matchAll(/^\| [A-Za-z0-9]+ \| ([^|]+) \|$/gmu)]
  .map(([, value = '']) => value.trim())
  .filter((value) => /^-?\d+(?:\.\d+)?$/u.test(value))
  .map(Number);

const held = (value: number): boolean => RESULT_VALUES.some((result) => Math.abs(result - value) < 1e-9);

const MONTH = String.raw`\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b`;

/** The numbers written in `text` (header): `[as written, value, is a percentage]`. */
export function numbersIn(text: string): (readonly [string, number, boolean])[] {
  const prose = text
    .replace(/`[^`]*`/gu, '')
    .replace(/\]\([^)]*\)/gu, ']')
    .replace(/\bChrome \d+/gu, 'Chrome')
    .replace(new RegExp(MONTH, 'gu'), 'a date');
  return [...prose.matchAll(/(?<![\w.§-])(\d+(?:\.\d+)?)(%?)(?![\w-])/gu)].map(
    ([written, digits = '', percent]) => [written, Number(digits), percent === '%'],
  );
}

/** The numbers in `text` that RESULTS.md does not hold, as written. */
export const unsourced = (text: string): string[] =>
  numbersIn(text)
    .filter(([, value, percent]) => !held(percent ? value / 100 : value))
    .map(([written]) => written);
