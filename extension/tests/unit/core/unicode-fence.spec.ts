/**
 * SEC-1 (Hard Rule 4): src/core never reads a character property from the engine. Every `\p{…}` class, `\s`,
 * `trim()`, case mapping and normalisation follows the Unicode version of the engine running it; src/core reads
 * character classes from the Unicode 15.0 tables (unicode-baseline.ts) instead. This scans src/core (not the
 * generated tables) for the constructs that would bring the engine's Unicode back:
 *  - `\p{…}` / `\P{…}` other than `ASCII` and `Cc` (both fixed forever), and `\s` / `\S`;
 *  - a regular expression with the `i` flag and `u` or `v` (Unicode case folding);
 *  - `toUpperCase`, the locale case mappings, `localeCompare` and `Intl`;
 *  - `trim()` and `toLowerCase()` other than on text already known to be ASCII, or in unicode-baseline.ts
 *    (`trimBaseline`, and `lowerBaseline`, which decides final sigma from the 15.0 tables first);
 *  - `normalize()` outside the three reader files, whose every reader the later-engine property
 *    (tests/property/unicode-baseline.property.spec.ts) checks.
 * Two files outside the readers still validate policy and stored text with the engine's classes; they are listed
 * in PENDING until they move to `BASELINE_CLASS` (Decisions [SEC-1]); nothing may be added to that list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CORE = path.resolve(import.meta.dirname, '../../../src/core');

type Rule =
  'property' | 'space-class' | 'unicode-ignore-case' | 'other-case' | 'trim' | 'normalize' | 'lowercase';

const RULES: readonly (readonly [Rule, RegExp])[] = [
  ['property', /\\{1,2}[pP]\{(?!ASCII\}|Cc\})[^}]*\}/g],
  ['space-class', /\\{1,2}[sS](?![A-Za-z{])/g],
  ['unicode-ignore-case', /\/[dgimsuyv]*(?:i[dgimsuyv]*[uv]|[uv][dgimsuyv]*i)[dgimsuyv]*(?![\w$])/g],
  ['other-case', /\.(?:toUpperCase|toLocaleLowerCase|toLocaleUpperCase|localeCompare)\(|\bIntl\b/g],
  ['trim', /\.trim(?:Start|End)?\(/g],
  ['normalize', /\.normalize\(/g],
  ['lowercase', /\.toLowerCase\(/g],
];

/** Files whose every reader the later-engine property runs: they may normalise text `asBaseline` prepared. */
const READER_FILES: ReadonlySet<string> = new Set([
  'normalize-text.ts',
  'normalize-amount.ts',
  'normalize-relative.ts',
]);
/** The baseline module: `trimBaseline` and `lowerBaseline` call the engine on text they made safe for it. */
const BASELINE_FILE = 'unicode-baseline.ts';
/** `trim()` or `toLowerCase()` on text an ASCII test (`^\p{ASCII}*$`) has just passed: no Unicode in it. */
const ASCII_LINES: ReadonlySet<string> = new Set([
  "return raw.toLowerCase().replace(ASCII_WHITESPACE_RUN, ' ').trim();",
  '? raw.toLowerCase().split(ASCII_NON_TOKEN)',
]);
/** Still on the engine's classes; may only shrink (Decisions [SEC-1]). */
const PENDING: Readonly<Record<string, readonly Rule[]>> = {};

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: Rule;
  readonly text: string;
}

/** `source` with comments blanked (line numbers kept). */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

function findings(file: string, source: string): Finding[] {
  return code(source)
    .split('\n')
    .flatMap((text, i) =>
      RULES.flatMap(([rule, pattern]) =>
        [...text.matchAll(pattern)].map(() => ({ file, line: i + 1, rule, text: text.trim() })),
      ),
    );
}

function allowed({ file, rule, text }: Finding): boolean {
  if (rule === 'normalize' && READER_FILES.has(file)) return true;
  if ((rule === 'trim' || rule === 'lowercase') && (file === BASELINE_FILE || ASCII_LINES.has(text)))
    return true;
  return PENDING[file]?.includes(rule) ?? false;
}

describe('src/core reads no character property from the engine', () => {
  it('finds every construct it looks for, and none in comments (the scan is not vacuous)', () => {
    const sample = [
      'const A = /\\p{L}\\s/u; const B = new RegExp(`[\\\\p{Mn}\\\\S]`, "u");',
      'const C = /x/iu; const D = /y/vi; const E = "a".toUpperCase() + "b".localeCompare("c");',
      'const F = s.trim() + s.trimEnd() + s.normalize("NFKC") + s.toLowerCase(); Intl.Collator;',
      '/* \\p{L} \\s s.trim() */ // s.normalize() /\\p{N}/u',
      'const OK = /\\P{ASCII}|[\\p{Cc}]/u; const G = /xn--/i;',
    ].join('\n');
    const rules = findings('sample.ts', sample).map(({ line, rule }) => `${line}:${rule}`);
    expect(rules).toEqual([
      '1:property',
      '1:property',
      '1:space-class',
      '1:space-class',
      '2:unicode-ignore-case',
      '2:unicode-ignore-case',
      '2:other-case',
      '2:other-case',
      '3:other-case',
      '3:trim',
      '3:trim',
      '3:normalize',
      '3:lowercase',
    ]);
  });

  it('every use in src/core is in a reader file, on ASCII text, in the baseline module, or pending', () => {
    const sources = readdirSync(CORE).filter(
      (file) => file.endsWith('.ts') && !file.startsWith('unicode-table-'),
    );
    expect(sources.length).toBeGreaterThan(50);
    const found = sources.flatMap((file) => findings(file, readFileSync(path.join(CORE, file), 'utf8')));
    expect(found.filter((finding) => !allowed(finding))).toEqual([]);
  });
});
