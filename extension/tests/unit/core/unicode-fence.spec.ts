/**
 * SEC-1 (Hard Rule 4): src/core never reads a character property from the engine. Every `\p{…}` class, `\s`,
 * `trim()`, case mapping and normalisation follows the Unicode version of the engine running it; src/core reads
 * character classes from the Unicode 15.0 tables (unicode-baseline.ts) instead. unicode-fence-scan.ts walks the
 * TypeScript syntax tree of every src/core file but the generated tables, so a comment never hides or fakes a
 * finding and a `//` inside a string is only a string. It refuses:
 *  - `\p{…}` / `\P{…}` other than `ASCII` and `Cc` (both fixed forever), and `\s` / `\S` (whatever follows it), in a
 *    regular expression literal, in string and template text as written and as read, in any text the file composes
 *    statically (a template, a `+`, a `const`), and in every pattern a `RegExp` is built from;
 *  - Unicode case folding: a regular expression with the `i` flag and `u` or `v`, or with `i` and a pattern that is
 *    not plain ASCII (without `u`, `i` still folds by the engine's case tables);
 *  - a regular expression built from text known only at run time. `RegExp(…)` and `new RegExp(…)` take a string
 *    literal for the flags (then the case-folding rule applies to it) and, for the pattern, a string literal or a
 *    template whose every substitution is a `BASELINE_CLASS` member imported from unicode-baseline.ts, a generated
 *    15.0 table imported by name, or a `const` declared once in the file and built the same way; a `+` is refused.
 *    Any other use of `RegExp`, `compile`, and `match`, `matchAll` or `search` called with anything but a regular
 *    expression or read to call later (`.call`, `.apply`, `.bind`, destructured), are refused;
 *  - `toUpperCase`, the locale case mappings, `localeCompare` and `Intl`, called or only referenced, and any string
 *    the file spells that names one of these methods (`Reflect.get(s, 'normalize')`);
 *  - `trim` and `toLowerCase` other than on text already known to be ASCII, or in unicode-baseline.ts
 *    (`trimBaseline`, and `lowerBaseline`, which decides final sigma from the 15.0 tables first);
 *  - `normalize` outside the three reader files, whose every reader the later-engine property
 *    (tests/property/unicode-baseline.property.spec.ts) checks.
 * ESLint closes the rest: the core fences refuse `globalThis` and `.constructor`, and the type-aware unbound-method
 * rule refuses any other read of a method's value (`const m = s.match`, `[s.normalize]`). No file is
 * exempt: policy-schema.ts and schema-text.ts read `BASELINE_CLASS` (Decisions [SEC-1]), there is no pending list,
 * and an exemption may not be added. unicode-fence-controls.spec.ts shows the scan finds what it looks for.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BASELINE_FILE, type Finding, findings, TABLE_SOURCES } from './unicode-fence-scan';

const CORE = path.resolve(import.meta.dirname, '../../../src/core');

/** Files whose every reader the later-engine property runs: they may normalise text `asBaseline` prepared. */
const READER_FILES: ReadonlySet<string> = new Set([
  'normalize-text.ts',
  'normalize-amount.ts',
  'normalize-relative.ts',
]);
/** `trim()` or `toLowerCase()` on text an ASCII test (`^\p{ASCII}*$`) has just passed: no Unicode in it. */
const ASCII_LINES: ReadonlySet<string> = new Set([
  "return raw.toLowerCase().replace(ASCII_WHITESPACE_RUN, ' ').trim();",
  '? raw.toLowerCase().split(ASCII_NON_TOKEN)',
]);

/** A normalisation in a reader file, or `trim` / `toLowerCase` on ASCII text or in the baseline module. */
function allowed({ file, rule, text }: Finding): boolean {
  if (rule === 'normalize' && READER_FILES.has(file)) return true;
  return (rule === 'trim' || rule === 'lowercase') && (file === BASELINE_FILE || ASCII_LINES.has(text));
}

describe('src/core reads no character property from the engine', () => {
  it('every use in src/core is a reader normalisation, on ASCII text, or in the baseline module', () => {
    const sources = readdirSync(CORE).filter((file) => file.endsWith('.ts') && !TABLE_SOURCES.has(file));
    expect(sources.length).toBeGreaterThan(50);
    const found = sources.flatMap((file) => findings(file, readFileSync(path.join(CORE, file), 'utf8')));
    expect(found.filter((finding) => !allowed(finding))).toEqual([]);
    // Each allowance is in use (the scan reads the files it allows), and no other file needs one.
    const allowedFiles = new Set(found.filter(allowed).map(({ file }) => file));
    expect([...allowedFiles].sort()).toEqual([...READER_FILES, BASELINE_FILE].sort());
  });

  it('skips only the tables scripts/gen-unicode-baseline.ts generates (unicode-tables.spec.ts checks them)', () => {
    const tables = readdirSync(CORE).filter((file) => file.startsWith('unicode-table-'));
    expect(tables.sort()).toEqual([...TABLE_SOURCES].sort());
    expect(TABLE_SOURCES.size).toBe(3);
  });
});
