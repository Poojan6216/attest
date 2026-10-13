/**
 * What every test of public copy shares (Sprint 7 close, tech review TECH-3 and TECH-14, QA review QA-10): the
 * repository's root, a section reader, one list of words no copy may use, the dash rule of the launch engineer's
 * outreach, and build_spec §11's limits as the README's first screen and the store listing's fourth paragraph must
 * both state them. The README (./readme.spec.ts), the launch kit (./launch-kit.spec.ts), the store listing
 * (./store-listing.spec.ts) and the strings people read in the extension (../copy.spec.ts) are held to these alone.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** The file at `file`, a path from the repository's root. */
export const read = (file: string): string => readFileSync(path.join(REPO_ROOT, file), 'utf8');

/** The text under `## heading` in `text`, up to the next `## `; throws when there is no such section. */
export function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`no section "${heading}"`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start + heading.length + 5, next === -1 ? undefined : next);
}

/**
 * The words no copy uses (agents/docs_writer.md rule 3, agents/launch_engineer.md, the ux engineer's copy rules): hype,
 * the marketing superlatives, and false urgency, spelled with a space, a hyphen or neither.
 */
export const HYPE =
  /\b(?:powerful|seamless(?:ly)?|enterprise[- ]?grade|AI[- ]?powered|powered by AI|revolutionary|magic(?:al)?|effortless(?:ly)?|cutting[- ]?edge|game[- ]?chang(?:er|ing)|blazing(?:ly)?(?:[- ]?fast)?|best[- ]?in[- ]?class|world[- ]?class|next[- ]?gen(?:eration)?|limited (?:spots|time)|act now)\b/iu;

/**
 * Any character drawn as a dash or a hyphen, which the launch engineer's outreach never holds (QA-10): Unicode's Dash
 * characters (the hyphen-minus, the hyphens and dashes, the minus sign, the fullwidth and small forms) and the soft
 * hyphen.
 */
export const DASH = /[\p{Dash}\u00AD]/u;

/**
 * build_spec.md §11's limits, one entry each, with the words by which a text states it. The README's first screen and
 * the store listing's fourth paragraph must each hold every entry's words (case aside), so neither can drop a limit
 * and keep a slogan; ./readme.spec.ts holds the list to §11's length.
 */
export const SECTION_11_LIMITS: readonly (readonly [string, readonly string[]])[] = [
  [
    'only open tabs',
    [
      'tabs you have open',
      'messenger',
      'phone calls',
      'purchases without an email receipt',
      'anything on your phone',
      'unverifiable',
    ],
  ],
  ['likely agent', ['likely agent', 'cannot prove who pressed send']],
  ['vendor pages change', ['vendor pages change', 'degraded']],
  ["the vendors' terms", ["does not read your ai agents' own pages", 'terms']],
  ['Dots needs Pro', ['dots requires a pro tier']],
  ['desktop Chrome', ['desktop chrome']],
  ['the on-device model', ['on-device model', 'your chrome and your computer', 'rules alone']],
];

/** The §11 limits `text` does not state, each with the words it lacks. */
export function missingLimits(text: string): string[] {
  const lower = text.toLowerCase().replace(/[’‘]/gu, "'");
  return SECTION_11_LIMITS.flatMap(([limit, words]) =>
    words.filter((word) => !lower.includes(word)).map((word) => `${limit}: "${word}"`),
  );
}
